// 영어 번역 (Senior Pastor · Samonim 전용, 「Translate to English」 버튼)
//  · { report: id }  → 그 보고서의 은혜와 나눔, 셀 케어, 기도제목, 결석 사유, 수정 요청 사유
//  · { notes: true } → 성도 동정 최근 30건의 내용과 기도제목
// 1) 로그인 토큰으로 본인 확인 → 2) 그 사람 권한으로 읽음(볼 수 없는 것은 번역 불가)
// 3) Claude API로 번역 (ANTHROPIC_API_KEY는 Vercel 환경 변수에만 있음). 번역문은 저장하지 않음
const SUPABASE_URL = 'https://mcbbhsvvzqvtrxlbdcks.supabase.co';
const PUBLISHABLE = 'sb_publishable_hs84BPU44TEcr2wM6boXIw_Saktd9p3';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODEL = process.env.TRANSLATE_MODEL || 'claude-sonnet-5-5';

async function asUser(token, path, body) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    method: body ? 'POST' : 'GET',
    headers: { apikey: PUBLISHABLE, Authorization: token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!r.ok) throw new Error('읽기 실패 ' + path.split('?')[0] + ' ' + r.status);
  return r.json();
}

const SYSTEM = `You translate short Korean texts from a church's cell-group care records into natural, warm English for the senior pastor.
Rules:
- Keep people's names, cell names and titles exactly as written in Korean (do not romanize or translate names).
- Church terms: 셀 = cell group, 셀원 = cell member, 셀리더 = cell leader, 목양 = pastoral care, 은혜 = grace, 나눔 = sharing, 기도제목 = prayer request, 예배 = worship service, 큐티/QT = quiet time, 말씀 = the Word, 성도 = church member, 새가족 = newcomer, 심방 = pastoral visit.
- Translate faithfully; do not add, soften or summarize. Keep line breaks.
- Reply with JSON only: an object mapping each given key to its English translation.`;

// 글자 수 제한이 없으므로(2026-11-10) 긴 글은 나눠 보낸다: 한 묶음 PIECE자 안팎, 한 글이 길면 줄바꿈에서 잘라 따로 번역한 뒤 이어 붙임
const PIECE = 6000, PARALLEL = 4;
function splitText(text) {
  const out = []; let rest = String(text);
  while (rest.length > PIECE) {
    const nl = rest.lastIndexOf('\n', PIECE);
    if (nl >= PIECE / 2) { out.push({ text: rest.slice(0, nl), sep: '\n' }); rest = rest.slice(nl + 1); }
    else { out.push({ text: rest.slice(0, PIECE), sep: '' }); rest = rest.slice(PIECE); }
  }
  out.push({ text: rest, sep: '' });
  return out;
}
async function translate(key, items, system) {
  const pieces = [], plan = {};
  for (const [k, v] of Object.entries(items)) {
    const ps = splitText(v);
    plan[k] = ps.map((p, i) => ({ id: ps.length > 1 ? k + '~part' + i : k, sep: p.sep }));
    ps.forEach((p, i) => pieces.push([plan[k][i].id, p.text]));
  }
  const batches = [];
  for (const [id, text] of pieces) {
    const last = batches[batches.length - 1];
    if (last && last.size + text.length <= PIECE) { last.items[id] = text; last.size += text.length; }
    else batches.push({ items: { [id]: text }, size: text.length });
  }
  const done = {};
  for (let i = 0; i < batches.length; i += PARALLEL)
    (await Promise.all(batches.slice(i, i + PARALLEL).map(b => translateOnce(key, b.items, system)))).forEach(r => Object.assign(done, r));
  const translations = {};
  for (const [k, parts] of Object.entries(plan))
    if (parts.every(p => typeof done[p.id] === 'string')) translations[k] = parts.map(p => done[p.id] + p.sep).join('');
  return translations;
}

async function translateOnce(key, items, system) {
  if (!Object.keys(items).length) return {};
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 16000, system: system || SYSTEM, messages: [{ role: 'user', content: JSON.stringify(items) }] })
  });
  const j = await r.json();
  if (!r.ok) { const e = new Error('Translation service error: ' + ((j.error && j.error.message) || r.status)); e.status = 502; throw e; }
  const text = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
  const m = text.match(/\{[\s\S]*\}/);
  let out;
  try { out = JSON.parse(m ? m[0] : text); } catch (_) { const e = new Error('Could not read the translation.'); e.status = 502; throw e; }
  const translations = {};
  for (const k of Object.keys(items)) if (typeof out[k] === 'string') translations[k] = out[k];
  return translations;
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
    const token = req.headers.authorization || '';
    if (!token.startsWith('Bearer ')) return res.status(401).json({ error: 'login required' });
    const key = (process.env.ANTHROPIC_API_KEY || '').trim();
    if (!key) return res.status(503).json({ error: 'Translation is not set up yet (ANTHROPIC_API_KEY).' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const id = body.report || '';
    const lrId = body.lr || '';
    if (!body.notes && !body.issues && !UUID.test(id) && !UUID.test(lrId)) return res.status(400).json({ error: 'report' });

    // 본인 권한 확인: Senior Pastor · Samonim 만
    const ctx = await asUser(token, 'rpc/get_my_context', {});
    const roles = (ctx && ctx.roles) || [];
    if (!roles.includes('senior_pastor') && !roles.includes('samonim')) return res.status(403).json({ error: 'Not allowed' });

    const items = {};
    const add = (k, v) => { if (v && String(v).trim()) items[k] = String(v); };

    if (UUID.test(lrId)) {
      const lr = await asUser(token, 'rpc/lr_read', { p_id: lrId });
      if (!lr) return res.status(404).json({ error: 'Report not found' });
      add('lr:sum', lr.summary);
      (lr.items || []).forEach(i => add('lri:' + i.id, i.content));
    } else if (body.issues) {
      const rows = await asUser(token, 'rpc/issue_board', { p_weeks: Math.min(26, Math.max(1, +body.issues || 8)), p_scope: 'all' });
      rows.slice(0, 120).forEach(r => { if (r.content) items['iss:' + r.source + ':' + r.item_id] = String(r.content); });
    } else if (body.notes) {
      const notes = await asUser(token, 'rpc/pastoral_note_list', { p_limit: 30, p_only_needs: false });
      notes.forEach(n => { add('note:' + n.id, n.content); add('noteprayer:' + n.id, n.prayer); });
    } else {
      const [rep] = await asUser(token, 'weekly_reports?select=id,grace_notes,meeting_cancel_reason,leader_message_note&id=eq.' + id);
      if (!rep) return res.status(404).json({ error: 'Report not found' });
      const [notes, newPrayers, prayers, roster, revisions] = await Promise.all([
        asUser(token, 'care_notes?select=id,content,prayer&report_id=eq.' + id),
        asUser(token, 'prayer_requests?select=id,content&report_id=eq.' + id),
        asUser(token, 'rpc/get_open_prayers', { p_report: id }),
        asUser(token, 'rpc/get_report_roster', { p_report: id }),
        asUser(token, 'revision_requests?select=id,reason&report_id=eq.' + id)
      ]);
      add('grace', rep.grace_notes);
      add('cancel', rep.meeting_cancel_reason);
      add('lmnote', rep.leader_message_note);
      notes.forEach(n => { add('care:' + n.id, n.content); add('careprayer:' + n.id, n.prayer); });
      newPrayers.forEach(p => add('newprayer:' + p.id, p.content));
      prayers.forEach(p => { add('prayer:' + p.prayer_id, p.content); add('prayernote:' + p.prayer_id, p.this_week_note); });
      roster.forEach(m => add('absence:' + m.member_id, m.absence_reason));
      revisions.forEach(r => add('rev:' + r.id, r.reason));
      try { const pm = await asUser(token, 'rpc/pastor_msg_get', { p_report: id }); if (pm && pm[0] && !pm[0].content_en) add('pmsg', pm[0].content); } catch (_) { }
    }
    const translations = await translate(key, items);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ translations });
  } catch (e) {
    console.error('translate failed:', String(e.message || e)); // Vercel Logs에서 원인 확인
    res.status(e.status || 500).json({ error: String(e.message || e) });
  }
};
module.exports.translate = translate;

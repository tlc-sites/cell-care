// 보고서 내용 영어 번역 (Senior Pastor · Samonim 전용, 「Translate to English」 버튼)
// 1) 로그인 토큰으로 본인 확인 → 2) 그 사람 권한으로 보고서를 읽음(볼 수 없는 보고서는 번역 불가)
// 3) Claude API로 번역 (ANTHROPIC_API_KEY는 Vercel 환경 변수에만 있음)
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

const SYSTEM = `You translate short Korean texts from a church cell-group care report into natural, warm English for the senior pastor.
Rules:
- Keep people's names, cell names and titles exactly as written in Korean (do not romanize or translate names).
- Church terms: 셀 = cell group, 셀원 = cell member, 셀리더 = cell leader, 목양 = pastoral care, 은혜 = grace, 나눔 = sharing, 기도제목 = prayer request, 예배 = worship service, 큐티/QT = quiet time, 말씀 = the Word, 성도 = church member, 새가족 = newcomer.
- Translate faithfully; do not add, soften or summarize. Keep line breaks.
- Reply with JSON only: an object mapping each given key to its English translation.`;

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
    const token = req.headers.authorization || '';
    if (!token.startsWith('Bearer ')) return res.status(401).json({ error: 'login required' });
    const key = (process.env.ANTHROPIC_API_KEY || '').trim();
    if (!key) return res.status(503).json({ error: 'Translation is not set up yet (ANTHROPIC_API_KEY).' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const id = body.report || '';
    if (!UUID.test(id)) return res.status(400).json({ error: 'report' });

    // 본인 권한 확인: Senior Pastor · Samonim 만
    const ctx = await asUser(token, 'rpc/get_my_context', {});
    const roles = (ctx && ctx.roles) || [];
    if (!roles.includes('senior_pastor') && !roles.includes('samonim')) return res.status(403).json({ error: 'Not allowed' });

    // 그 사람 권한으로 보고서 읽기 (볼 수 없으면 비어 있음)
    const [rep] = await asUser(token, 'weekly_reports?select=id,grace_notes,meeting_cancel_reason&id=eq.' + id);
    if (!rep) return res.status(404).json({ error: 'Report not found' });
    const [notes, newPrayers, prayers, roster, revisions] = await Promise.all([
      asUser(token, 'care_notes?select=id,content&report_id=eq.' + id),
      asUser(token, 'prayer_requests?select=id,content&report_id=eq.' + id),
      asUser(token, 'rpc/get_open_prayers', { p_report: id }),
      asUser(token, 'rpc/get_report_roster', { p_report: id }),
      asUser(token, 'revision_requests?select=id,reason&report_id=eq.' + id)
    ]);
    const items = {};
    const add = (k, v) => { if (v && String(v).trim()) items[k] = String(v).slice(0, 4000); };
    add('grace', rep.grace_notes);
    add('cancel', rep.meeting_cancel_reason);
    notes.forEach(n => add('care:' + n.id, n.content));
    newPrayers.forEach(p => add('newprayer:' + p.id, p.content));
    prayers.forEach(p => { add('prayer:' + p.prayer_id, p.content); add('prayernote:' + p.prayer_id, p.this_week_note); });
    roster.forEach(m => add('absence:' + m.member_id, m.absence_reason));
    revisions.forEach(r => add('rev:' + r.id, r.reason));
    if (!Object.keys(items).length) return res.status(200).json({ translations: {} });

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL, max_tokens: 4000, system: SYSTEM,
        messages: [{ role: 'user', content: JSON.stringify(items) }]
      })
    });
    const j = await r.json();
    if (!r.ok) return res.status(502).json({ error: 'Translation service error: ' + ((j.error && j.error.message) || r.status) });
    const text = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
    const m = text.match(/\{[\s\S]*\}/);
    let out = {};
    try { out = JSON.parse(m ? m[0] : text); } catch (_) { return res.status(502).json({ error: 'Could not read the translation.' }); }
    const translations = {};
    for (const k of Object.keys(items)) if (typeof out[k] === 'string') translations[k] = out[k];
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ translations });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};

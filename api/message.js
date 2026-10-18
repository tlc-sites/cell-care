// 메시지를 보낸 뒤: (담임 목사님이 들어 있는 대화면) 번역해 두고, 받는 분들께 알림
//  POST { post: <uuid> }  — 보낸 본인만 (10분 안)
const { serviceRpc, authUser, sendAll } = require('./_lib');
const { translate } = require('./translate');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TO_EN = `You translate a short Korean message between church staff and cell leaders into natural, warm English for the senior pastor.
- Keep people's names, cell names and titles exactly as written in Korean (do not romanize).
- 셀 = cell group, 셀원 = cell member, 셀리더 = cell leader, 기도제목 = prayer request, 심방 = pastoral visit.
- Translate faithfully; do not add, soften or summarize. Keep line breaks.
- Reply with JSON only: an object mapping each given key to its English translation.`;
const TO_KO = `You translate a short English message from the senior pastor of a Korean church into natural, warm Korean (존댓말) for a cell leader.
- Keep people's names exactly as written. cell group = 셀, cell leader = 셀리더.
- Translate faithfully; do not add, soften or summarize. Keep line breaks.
- Reply with JSON only: an object mapping each given key to its Korean translation.`;

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
    const user = await authUser(req);
    if (!user || !user.id) return res.status(401).json({ error: 'login required' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    if (!UUID.test(body.post || '')) return res.status(400).json({ error: 'post' });
    const rows = await serviceRpc('msg_for_send', { p_post: body.post, p_auth_user: user.id });
    if (!rows.length) return res.status(200).json({ sent: 0 });
    const m = rows[0];
    let tr = '';
    if (m.has_senior) {
      try {
        const key = (process.env.ANTHROPIC_API_KEY || '').trim();
        if (key) tr = (await translate(key, { c: m.body }, /[가-힣]/.test(m.body) ? TO_EN : TO_KO)).c || '';
      } catch (_) { tr = ''; }
      if (tr) await serviceRpc('msg_mark', { p_post: body.post, p_tr: tr });
    }
    const hangul = /[가-힣]/.test(m.body);
    const short = (s) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > 90 ? s.slice(0, 88) + '…' : s; };
    const targets = await serviceRpc('msg_push_targets', { p_post: body.post });
    const result = await sendAll(targets, (x) => x.lang === 'en'
      ? { title: '✉️ Message from ' + m.author, body: short(hangul && tr ? tr : m.body) + (m.report_label ? '\n(' + m.report_label + ' report attached)' : ''), tag: 'msg-' + m.thread_id, url: './' }
      : { title: '✉️ ' + m.author + '님의 메시지', body: short(!hangul && tr ? tr : m.body) + (m.report_label ? '\n(' + m.report_label + ' 보고서 함께 보냄)' : ''), tag: 'msg-' + m.thread_id, url: './' });
    res.status(200).json({ translated: !!tr, ...result });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};

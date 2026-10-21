// 셀보고서 「담임 목사님께 드리는 말씀」: 제출 직후 앱이 부름
// 제출한 본인 로그인이 맞을 때만 → 영어로 번역해 저장 → 담임 목사님·담임 사모님 휴대폰으로 바로 알림
const { serviceRpc, authUser, sendAll, env } = require('./_lib');
const { translate } = require('./translate');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
    const user = await authUser(req);
    if (!user || !user.id) return res.status(401).json({ error: '로그인이 필요합니다.' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    if (!UUID.test(body.report || '')) return res.status(400).json({ error: 'report' });
    const rows = await serviceRpc('pastor_msg_for_send', { p_report: body.report, p_auth_user: user.id });
    if (!rows.length) return res.status(200).json({ sent: 0 });
    const m = rows[0];
    let en = '';
    try {
      const key = (process.env.ANTHROPIC_API_KEY || '').trim();
      if (key) en = (await translate(key, { msg: m.content })).msg || '';
    } catch (_) { en = ''; }
    await serviceRpc('pastor_msg_mark_sent', { p_report: body.report, p_content: m.content, p_en: en });
    const targets = await serviceRpc('senior_push_targets', {});
    const short = (s) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > 90 ? s.slice(0, 88) + '…' : s; };
    const result = await sendAll(targets, (x) => x.lang === 'en'
      ? { title: '✉️ A message for you from ' + m.author, body: (en ? short(en) : short(m.content)) + '\n(' + m.cell_name + ')', tag: 'pmsg-' + body.report }
      : { title: '✉️ ' + m.author + '님이 담임 목사님께 드리는 말씀', body: short(m.content) + '\n(' + m.cell_name + ')', tag: 'pmsg-' + body.report });
    res.status(200).json({ translated: !!en, ...result });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};

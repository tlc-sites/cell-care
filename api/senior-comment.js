// 담임 목사님·사모님 코멘트: 남기신 직후 앱이 부름
// 남기신 본인 로그인이 맞을 때만 → (영어면) 한국어로 번역해 저장 → 셀리더(·담당 분파셀리더) 휴대폰으로 알림
const { serviceRpc, authUser, sendAll } = require('./_lib');
const { translate } = require('./translate');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TO_KO = `You translate short English comments from a church's senior pastor (or his wife) into natural, warm Korean for cell-group leaders.
Rules:
- Use polite, warm Korean (존댓말) as a pastor would write to a church member. Avoid stiff, translated-sounding phrasing.
- Keep people's names exactly as written. Church terms: cell group = 셀, cell leader = 셀리더, prayer = 기도, grace = 은혜.
- Translate faithfully; do not add, soften or summarize. Keep line breaks.
- Reply with JSON only: an object mapping each given key to its Korean translation.`;
module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
    const user = await authUser(req);
    if (!user || !user.id) return res.status(401).json({ error: 'login required' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const short = (s) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > 90 ? s.slice(0, 88) + '…' : s; };
    const toKo = async (text) => {
      if (/[가-힣]/.test(text)) return '';
      try {
        const key = (process.env.ANTHROPIC_API_KEY || '').trim();
        return key ? ((await translate(key, { c: text }, TO_KO)).c || '') : '';
      } catch (_) { return ''; }
    };
    // 성도 동정 코멘트 → 동정을 쓴 분께
    if (UUID.test(body.note_comment || '')) {
      const rows = await serviceRpc('note_comment_for_send', { p_id: body.note_comment, p_auth_user: user.id });
      if (!rows.length) return res.status(200).json({ sent: 0 });
      const c = rows[0];
      const ko = await toKo(c.content);
      await serviceRpc('note_comment_mark', { p_id: body.note_comment, p_ko: ko });
      const targets = await serviceRpc('note_comment_push_targets', { p_id: body.note_comment });
      const result = await sendAll(targets, (x) => x.lang === 'en'
        ? { title: '💬 ' + c.author + ' commented on your note', body: short(c.content) + '\n(' + c.person_name + ')', tag: 'ncmt-' + body.note_comment }
        : { title: '💬 ' + c.author + '께서 성도 동정에 코멘트를 남기셨습니다', body: short(ko || c.content) + '\n(' + c.person_name + ')', tag: 'ncmt-' + body.note_comment });
      return res.status(200).json({ translated: !!ko, ...result });
    }
    if (!UUID.test(body.comment || '')) return res.status(400).json({ error: 'comment' });
    const rows = await serviceRpc('senior_comment_for_send', { p_id: body.comment, p_auth_user: user.id });
    if (!rows.length) return res.status(200).json({ sent: 0 });
    const c = rows[0];
    let ko = '';
    if (!/[가-힣]/.test(c.content)) {
      try {
        const key = (process.env.ANTHROPIC_API_KEY || '').trim();
        if (key) ko = (await translate(key, { c: c.content }, TO_KO)).c || '';
      } catch (_) { ko = ''; }
    }
    await serviceRpc('senior_comment_mark', { p_id: body.comment, p_ko: ko });
    const targets = await serviceRpc('senior_comment_push_targets', { p_id: body.comment });
    const what = c.target === 'pastor_msg' ? '목사님께 드린 말씀에 답글을' : '셀보고서에 코멘트를';
    const result = await sendAll(targets, (x) => x.lang === 'en'
      ? { title: '💬 ' + c.author + ' left a ' + (c.target === 'pastor_msg' ? 'reply' : 'comment'), body: short(c.content) + '\n(' + c.cell_name + ')', tag: 'cmt-' + body.comment }
      : { title: '💬 ' + c.author + '께서 ' + what + ' 남기셨습니다', body: short(ko || c.content) + '\n(' + c.cell_name + ')', tag: 'cmt-' + body.comment });
    res.status(200).json({ translated: !!ko, ...result });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};

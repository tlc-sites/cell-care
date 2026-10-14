// 성도 동정에 '목사님 확인 필요'를 표시하면 목사님·사모님께 바로 알림
// 쓴 본인의 로그인 토큰이 맞을 때, 같은 동정은 한 번만
const { serviceRpc, authUser, sendAll } = require('./_lib');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
    const user = await authUser(req);
    if (!user || !user.id) return res.status(401).json({ error: '로그인이 필요합니다.' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    if (!UUID.test(body.note || '')) return res.status(400).json({ error: 'note' });
    const targets = await serviceRpc('note_push_targets', { p_note: body.note, p_auth_user: user.id });
    if (!targets.length) return res.status(200).json({ targets: 0 });
    const t = targets[0];
    const result = await sendAll(targets, (x) => x.lang === 'en'
      ? { title: '🙏 Pastoral note needs your attention', body: t.author + ' wrote about ' + t.person + '.\nPlease take a look in Cell Care.', tag: 'note-' + body.note }
      : { title: '🙏 목사님 확인이 필요한 성도 동정', body: t.author + '님이 ' + t.person + '님에 대한 동정을 남겼습니다.\n셀 케어에서 확인해 주세요.', tag: 'note-' + body.note });
    res.status(200).json(result);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};

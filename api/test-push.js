// 테스트 알림: 로그인한 본인 휴대폰으로만 보냅니다.
const { serviceRpc, authUser, sendAll } = require('./_lib');
module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
    const user = await authUser(req);
    if (!user || !user.id) return res.status(401).json({ error: '로그인이 필요합니다.' });
    const targets = await serviceRpc('push_targets_for_auth_user', { p_auth_user: user.id });
    if (!targets.length) return res.status(200).json({ targets: 0, sent: 0 });
    const result = await sendAll(targets, { title: '셀 케어 테스트 알림', body: '알림이 잘 도착했습니다. 월요일 아침과 토요일 저녁에 알려 드릴게요.', tag: 'test' });
    res.status(200).json(result);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};

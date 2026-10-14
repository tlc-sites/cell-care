// 등록 신청이 들어오면 관리자 휴대폰으로 알림 (로그인 전 화면에서 부름)
// 서버가 "아직 알리지 않은 최근 신청"이 있을 때만 보내므로, 이 주소를 여러 번 불러도 중복으로 가지 않음
const { serviceRpc, sendAll } = require('./_lib');
module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
    const targets = await serviceRpc('request_notify_targets', {});
    if (!targets.length) return res.status(200).json({ targets: 0 });
    const names = String(targets[0].names || '').slice(0, 60);
    const result = await sendAll(targets, {
      title: '🙋 새 등록 신청이 있습니다',
      body: names + '님이 셀 케어 등록을 신청했습니다.\n관리 탭에서 확인해 주세요.',
      tag: 'access-request'
    });
    res.status(200).json(result);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};

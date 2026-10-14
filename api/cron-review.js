// 토요일 저녁 8시: 확인을 기다리는 보고서가 있는 Leadership에게 알림 (Vercel Cron, CRON_SECRET 필요)
const { serviceRpc, sendAll, seoulToday, env } = require('./_lib');
module.exports = async (req, res) => {
  try {
    if ((req.headers.authorization || '') !== 'Bearer ' + env('CRON_SECRET')) return res.status(401).json({ error: 'unauthorized' });
    const t = seoulToday();
    if (t.dow !== 6) return res.status(200).json({ skipped: '토요일에만 보냅니다', today: t.iso });
    const targets = await serviceRpc('review_push_targets', {});
    const result = await sendAll(targets, { title: '📋 맡으신 셀의 보고서를 확인하셨나요?', body: '셀리더가 작성한 이번 주 셀보고서를 확인해 주세요.', tag: 'review-' + t.iso, url: './' });
    res.status(200).json({ today: t.iso, ...result });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};

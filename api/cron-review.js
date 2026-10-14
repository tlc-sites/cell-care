// 금요일 오후 1시: 분파리더에게 "셀보고서 확인 + 교역자 보고 작성" 알림 (Vercel Cron, CRON_SECRET 필요)
//   이번 주 교역자 보고를 아직 제출하지 않은 분파리더만
const { serviceRpc, sendAll, seoulToday, env } = require('./_lib');
module.exports = async (req, res) => {
  try {
    if ((req.headers.authorization || '') !== 'Bearer ' + env('CRON_SECRET')) return res.status(401).json({ error: 'unauthorized' });
    const t = seoulToday();
    if (t.dow !== 5) return res.status(200).json({ skipped: '금요일에만 보냅니다', today: t.iso });
    const targets = await serviceRpc('lr_push_targets', {});
    const result = await sendAll(targets, (x) => x.lang === 'en'
      ? { title: '📋 Time for this week’s pastoral report', body: 'Please review your cells’ reports and write this week’s pastoral report.', tag: 'lr-' + t.iso, url: './' }
      : { title: '📋 맡으신 셀의 보고서를 확인하셨나요?', body: '셀리더 보고서를 확인하시고, 이번 주 교역자 보고를 작성해 주세요.', tag: 'lr-' + t.iso, url: './' });
    res.status(200).json({ today: t.iso, ...result });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};

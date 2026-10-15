// 금요일 오후 5시: 담임 목사님·사모님께 "이번 주 교역자 보고가 준비되었습니다" 알림 (Vercel Cron, CRON_SECRET 필요)
const { serviceRpc, sendAll, seoulToday, env } = require('./_lib');
module.exports = async (req, res) => {
  try {
    if ((req.headers.authorization || '') !== 'Bearer ' + env('CRON_SECRET')) return res.status(401).json({ error: 'unauthorized' });
    const t = seoulToday();
    if (t.dow !== 5) return res.status(200).json({ skipped: '금요일에만 보냅니다', today: t.iso });
    const targets = await serviceRpc('senior_push_targets', {});
    const n = targets.length ? targets[0].submitted : 0;
    const result = await sendAll(targets, (x) => x.lang === 'en'
      ? { title: '📋 This week’s pastoral reports are ready', body: n + ' report(s) from Leadership. Please take a look in Cell Care.', tag: 'senior-' + t.iso, url: './' }
      : { title: '📋 이번 주 교역자 보고가 준비되었습니다', body: '분파리더들이 정리한 이번 주 셀 소식을 확인해 주세요. (보고 ' + n + '건)', tag: 'senior-' + t.iso, url: './' });
    res.status(200).json({ today: t.iso, ...result });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};

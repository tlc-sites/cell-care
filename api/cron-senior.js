// 금요일 오후 5시: 담임 목사님·사모님께 "이번 주 교역자 보고가 준비되었습니다" 알림 (Vercel Cron, CRON_SECRET 필요)
const { serviceRpc, sendAll, seoulToday, env } = require('./_lib');
module.exports = async (req, res) => {
  try {
    if ((req.headers.authorization || '') !== 'Bearer ' + env('CRON_SECRET')) return res.status(401).json({ error: 'unauthorized' });
    const t = seoulToday();
    // 처음 배포하는 주: 금요일 오후 5시 1차, 토요일 오후 5시 2차
    const ROUND1 = ['2026-10-16'], ROUND2 = ['2026-10-17'];
    const second = t.dow === 6 && ROUND2.includes(t.iso);
    if (t.dow !== 5 && !second) return res.status(200).json({ skipped: '금요일에만 보냅니다', today: t.iso });
    const first = ROUND1.includes(t.iso);
    const targets = await serviceRpc('senior_push_targets', {});
    const n = targets.length ? targets[0].submitted : 0;
    const result = await sendAll(targets, (x) => x.lang === 'en'
      ? { title: second ? '📋 Second round: this week’s reports' : first ? '📋 First round: this week’s reports' : '📋 This week’s pastoral reports are ready',
          body: n + ' report(s) from Leadership' + (second ? ' as of Saturday 5 PM.' : first ? ' so far. A second round follows Saturday 5 PM.' : '.') + ' Please take a look in Cell Care.', tag: 'senior-' + t.iso, url: './' }
      : { title: second ? '📋 이번 주 셀 소식 2차 정리' : first ? '📋 이번 주 셀 소식 1차 정리' : '📋 이번 주 교역자 보고가 준비되었습니다',
          body: (second ? '토요일 오후 5시까지 모인' : first ? '지금까지 모인' : '분파리더들이 정리한') + ' 이번 주 셀 소식을 확인해 주세요. (보고 ' + n + '건)' + (first ? ' 2차 정리는 토요일 오후 5시에 알려 드립니다.' : ''), tag: 'senior-' + t.iso, url: './' });
    res.status(200).json({ today: t.iso, ...result });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};

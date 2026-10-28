// 정해진 시간에 도는 일을 한 곳에 모음 (Vercel 무료 요금제 서버 기능 12개 제한 때문에 합침)
//  ?job=reminder : 셀리더 알림 (월 아침 격려 · 목 밤 · 금 아침 마감 안내)
//  ?job=review   : 분파셀리더 확인 알림 (금 오후 1시)
//  ?job=senior   : 담임 목사님·담임 사모님 알림 (금 오후 5시)
//  ?job=digest   : 주간 요약 메일 (금 밤 11:59) · 앱 안 미리보기/테스트 발송(POST)
//  ?job=pastoral : 셀모임 2주 이상 연속 미진행 → 목회적 케어 보고 + 목사님·사모님 메일 (매일 오후 1:30)
// 각 일은 그 안에서 CRON_SECRET(또는 로그인)을 따로 확인합니다.
const jobs = {
  reminder: require('./_cron-reminder'),
  review: require('./_cron-review'),
  senior: require('./_cron-senior'),
  digest: require('./_digest'),
  pastoral: require('./_pastoral'),
};
module.exports = (req, res) => {
  const job = jobs[(req.query && req.query.job) || ''];
  if (!job) return res.status(404).json({ error: 'unknown job' });
  return job(req, res);
};

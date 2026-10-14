// 매주 셀리더 알림 (Vercel Cron이 부름, CRON_SECRET이 맞아야 실행)
//  · 월요일 오전 9시: 셀원 돌봄 격려 → 그 주 셀리더 모두
//  · 금요일 오전 10시: 셀보고서 리마인드 → 오늘 낮 12시가 마감인데 아직 내지 않은 셀리더만
//    (토요일에 모이는 셀은 다음 주 금요일이 마감이라 그 주에 알림)
const { serviceRpc, sendAll, seoulToday, env } = require('./_lib');

module.exports = async (req, res) => {
  try {
    if ((req.headers.authorization || '') !== 'Bearer ' + env('CRON_SECRET')) return res.status(401).json({ error: 'unauthorized' });
    const t = seoulToday();
    let targets, payload;
    if (t.dow === 1) {          // 월요일: 이번 주 셀리더 모두에게 격려
      targets = await serviceRpc('leader_push_targets', { p_week: t.iso });
      payload = { title: '이번 한 주도 하나님의 사랑으로 🌿', body: '이번 한 주도 하나님의 사랑으로 셀원들을 돌아보고 섬겨주세요.', tag: 'care-' + t.iso };
    } else if (t.dow === 5) {   // 금요일: 오늘 마감 미제출 셀리더
      targets = await serviceRpc('friday_reminder_targets', {});
      payload = { title: '📋 셀보고서, 잊지 않으셨죠?', body: '오늘 낮 12시가 마감입니다. 아직 작성 전이라면 셀보고서를 작성해 주세요.', tag: 'report-' + t.iso };
    } else {
      return res.status(200).json({ skipped: '월요일·금요일에만 보냅니다', today: t.iso });
    }
    const result = await sendAll(targets, payload);
    res.status(200).json({ today: t.iso, ...result });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};

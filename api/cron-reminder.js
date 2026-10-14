// 매주 알림 (Vercel Cron이 부름, CRON_SECRET이 맞아야 실행)
//  · 월요일 오전 9시: 셀원 돌봄 격려 → 그 주 셀리더 모두
//  · 토요일 오후 6시: 셀보고서 리마인드 → 이번 주 보고서를 아직 내지 않은 셀리더만
const { serviceRpc, sendAll, seoulToday, env } = require('./_lib');

function addDays(iso, n) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

module.exports = async (req, res) => {
  try {
    if ((req.headers.authorization || '') !== 'Bearer ' + env('CRON_SECRET')) return res.status(401).json({ error: 'unauthorized' });
    const t = seoulToday();
    let week, targets, payload;
    if (t.dow === 1) {          // 월요일: 이번 주 셀리더 모두에게 격려
      week = t.iso;
      targets = await serviceRpc('leader_push_targets', { p_week: week });
      payload = { title: '이번 한 주도 하나님의 사랑으로 🌿', body: '이번 한 주도 하나님의 사랑으로 셀원들을 돌아보고 섬겨주세요.', tag: 'care-' + week };
    } else if (t.dow === 6) {   // 토요일: 이번 주(월~주일) 보고서 미제출 셀리더
      week = addDays(t.iso, -5);
      targets = await serviceRpc('reminder_targets', { p_week: week });
      payload = { title: '📋 셀보고서, 잊지 않으셨죠?', body: '아직 작성 전이라면 이번 주 셀보고서를 작성해 주세요.', tag: 'report-' + week };
    } else {
      return res.status(200).json({ skipped: '월요일·토요일에만 보냅니다', today: t.iso });
    }
    const result = await sendAll(targets, payload);
    res.status(200).json({ today: t.iso, week, ...result });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};

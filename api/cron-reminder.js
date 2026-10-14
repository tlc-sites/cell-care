// 매주 알림: 주일 저녁 → 이번 주 미제출 셀리더, 월요일 저녁(마감일) → 지난주 미제출 셀리더
// Vercel Cron이 부릅니다. CRON_SECRET이 맞아야만 실행됩니다.
const { serviceRpc, sendAll, seoulToday, env } = require('./_lib');

function addDays(iso, n) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

module.exports = async (req, res) => {
  try {
    if ((req.headers.authorization || '') !== 'Bearer ' + env('CRON_SECRET')) return res.status(401).json({ error: 'unauthorized' });
    const t = seoulToday();
    let week, payload;
    if (t.dow === 0) {          // 주일: 이번 주(월~주일)
      week = addDays(t.iso, -6);
      payload = { title: '셀 케어', body: '이번 주 셀 모임은 어떠셨나요? 셀 보고서를 써 주세요. 마감은 내일(월) 밤까지입니다.', tag: 'weekly-' + week };
    } else if (t.dow === 1) {   // 월요일: 지난주 보고서 마감일
      week = addDays(t.iso, -7);
      payload = { title: '셀 케어 · 오늘 마감', body: '지난주 셀 보고서 마감이 오늘 밤입니다. 아직이시면 잠시 시간 내어 써 주세요.', tag: 'deadline-' + week };
    } else {
      return res.status(200).json({ skipped: '주일·월요일에만 보냅니다', today: t.iso });
    }
    const targets = await serviceRpc('reminder_targets', { p_week: week });
    const result = await sendAll(targets, payload);
    res.status(200).json({ today: t.iso, week, ...result });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};

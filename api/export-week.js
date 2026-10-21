// 구글 시트 자동 정리용: 한 주의 셀보고서 현황·출석·셀 케어·기도제목을 돌려줌
// 구글 Apps Script가 매주 금요일 저녁에 부름. EXPORT_TOKEN(Vercel 환경 변수)이 맞아야만 응답
// ※ 받는 사람을 정해서 남긴 것(담임 목사님께 드리는 말씀, 지정 공개 성도 동정, 메시지)은 내용 없이 기록만
const crypto = require('crypto');
const { serviceRpc, env } = require('./_lib');
module.exports = async (req, res) => {
  try {
    const want = env('EXPORT_TOKEN');
    const got = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const a = Buffer.from(got), b = Buffer.from(want);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'unauthorized' });
    const week = String((req.query && req.query.week) || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) return res.status(400).json({ error: 'week=YYYY-MM-DD' });
    const data = await serviceRpc('export_week', { p_week: week });
    // 성도 동정·교역자 보고·확인 기록·코멘트 + 특수 보고 기록(내용 없음). 아직 설치 전이면 건너뜀
    try { Object.assign(data, await serviceRpc('export_week_more', { p_week: week })); } catch (_) {}
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};

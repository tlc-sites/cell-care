// 셀리더가 보고서를 제출하면 확인할 분(담당 Leadership 또는 목사님·사모님)에게 바로 알림
// 앱이 제출 직후 부름. 제출한 본인 로그인 토큰이 맞을 때, 같은 제출은 한 번만 보냄
const { serviceRpc, authUser, sendAll } = require('./_lib');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function honor(name) { name = String(name || '').trim(); return /\s/.test(name) ? name + '님' : name + ' 셀리더님'; }
module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
    const user = await authUser(req);
    if (!user || !user.id) return res.status(401).json({ error: '로그인이 필요합니다.' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    if (!UUID.test(body.report || '')) return res.status(400).json({ error: 'report' });
    const targets = await serviceRpc('submit_push_targets', { p_report: body.report, p_auth_user: user.id });
    if (!targets.length) return res.status(200).json({ targets: 0 });
    const t = targets[0];
    const again = t.submission_no > 1;
    const result = await sendAll(targets, (x) => x.lang === 'en' ? {
      title: '📋 ' + (again ? 'Cell report resubmitted' : 'New cell report submitted'),
      body: t.submitter + (again ? ' revised and resubmitted the ' : ' submitted the ') + t.cell_name + ' report.\nPlease take a look.',
      tag: 'submit-' + body.report + '-' + t.submission_no
    } : {
      title: '📋 ' + (again ? '셀보고서가 다시 제출되었습니다' : '새로운 셀보고서가 작성되었습니다'),
      body: honor(t.submitter) + '이 ' + (again ? '셀보고서를 고쳐서 다시 제출했습니다.' : '셀보고서를 작성했습니다.') + '\n내용을 확인해 주세요.',
      tag: 'submit-' + body.report + '-' + t.submission_no
    });
    res.status(200).json(result);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};

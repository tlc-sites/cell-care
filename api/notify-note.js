// 성도 동정 알림 · 공지 알림({ notice }): 골라서 보이게 한 교역자, 목사님·사모님께는 모든 새 동정을 바로
// 쓴 본인의 로그인 토큰이 맞을 때, 같은 동정은 한 번만
const { serviceRpc, authUser, sendAll } = require('./_lib');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
    const user = await authUser(req);
    if (!user || !user.id) return res.status(401).json({ error: '로그인이 필요합니다.' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    // 공지 알림 (서버 기능 수 제한 때문에 여기에 함께 둠): 쓴 분 본인이 10분 안에 한 번만
    if (body.notice) {
      if (!UUID.test(body.notice)) return res.status(400).json({ error: 'notice' });
      const nt = await serviceRpc('notice_push_targets', { p_id: body.notice, p_auth_user: user.id });
      if (!nt.length) return res.status(200).json({ targets: 0 });
      const n0 = nt[0];
      const r = await sendAll(nt, (x) => x.lang === 'en'
        ? { title: '📢 ' + n0.title, body: 'Notice from ' + n0.author + '. Tap to read in Cell Care.', tag: 'notice-' + body.notice }
        : { title: '📢 ' + n0.title, body: n0.author + '님이 공지를 올렸습니다. 셀 케어에서 확인해 주세요.', tag: 'notice-' + body.notice });
      return res.status(200).json(r);
    }
    if (!UUID.test(body.note || '')) return res.status(400).json({ error: 'note' });
    const targets = await serviceRpc('note_push_targets', { p_note: body.note, p_auth_user: user.id });
    if (!targets.length) return res.status(200).json({ targets: 0 });
    const t = targets[0];
    const result = await sendAll(targets, (x) => {
      const pastor = x.kind === 'pastor', senior = x.kind === 'senior';
      return x.lang === 'en'
        ? { title: pastor ? '🙏 Pastoral note needs your attention' : senior ? '🙏 New pastoral note' : '🙏 A pastoral note was shared with you',
            body: t.author + ' wrote about ' + t.person + '.\nPlease take a look in Cell Care.', tag: 'note-' + body.note }
        : { title: pastor ? '🙏 목사님 확인이 필요한 성도 동정' : senior ? '🙏 새 성도 동정이 올라왔습니다' : '🙏 성도 동정이 공유되었습니다',
            body: t.author + '님이 ' + t.person + '님에 대한 동정을 ' + (pastor || senior ? '남겼습니다.' : '함께 보도록 공유했습니다.') + '\n셀 케어에서 확인해 주세요.', tag: 'note-' + body.note };
    });
    res.status(200).json(result);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};

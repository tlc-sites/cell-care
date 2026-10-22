'use strict';
const INBOX = { rows: [], loadedAt: 0, loading: false, error: '', pending: CellCareRoutes.parse(location.hash) || CellCareRoutes.parse(new URLSearchParams(location.search).get('notification')), replyRows: {}, replyOpen: '', replyDrafts: {}, replyBusy: false };
function rememberNotificationRoute(route) {
  const url = new URL(location.href);
  const key = route.kind === 'section' ? 'section' : route.kind;
  url.searchParams.set('notification', '#' + key + '=' + route.id + (route.comment ? '&comment=' + route.comment : '') + (route.talk ? '&talk=' + route.talk : ''));
  history.replaceState(history.state, '', url.pathname + url.search + url.hash);
}
if (INBOX.pending) rememberNotificationRoute(INBOX.pending);
function bellButton() {
  return '<button class="iconbtn notification-bell" data-notification-action="open" aria-label="' + tr('알림함', 'Notifications') + '"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg><span id="notification-count" class="pill warn" hidden></span></button>';
}
function updateInboxBadge() {
  const badge = document.getElementById('notification-count');
  if (!badge) return;
  const count = INBOX.rows.filter(n => !n.read_at).length;
  badge.hidden = !count; badge.textContent = count > 99 ? '99+' : String(count);
}
async function refreshInboxBadge(force = false) {
  if (!S.ctx || DEMO.role || INBOX.loading || (!force && Date.now() - INBOX.loadedAt < 30000)) { updateInboxBadge(); return; }
  INBOX.loading = true;
  const userId = S.me.id;
  try {
    const rows = await rpc('cellcare_notification_list');
    if (S.me?.id === userId && S.ctx) { INBOX.rows = rows || []; INBOX.loadedAt = Date.now(); INBOX.error = ''; }
  } catch (_) { INBOX.error = tr('알림을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.', 'Notifications could not be loaded. Please try again.'); }
  finally { INBOX.loading = false; updateInboxBadge(); }
}
function resetInbox() {
  Object.assign(INBOX, { rows: [], loadedAt: 0, error: '', replyRows: {}, replyOpen: '', replyDrafts: {}, replyBusy: false });
}
async function viewNotifications(app) {
  setTop(tr('알림함', 'Notifications'), true); renderTabs(true);
  await refreshInboxBadge(true);
  app.innerHTML = '<h1>' + tr('알림함', 'Notifications') + '</h1><div class="row" style="gap:12px;margin-bottom:12px"><button class="btn quiet sm" data-notification-action="refresh">' + tr('새로고침', 'Refresh') + '</button><button class="link" data-notification-action="read-all">' + tr('모두 읽음', 'Mark all read') + '</button></div>' +
    (INBOX.error ? '<div class="banner warn" role="alert">' + esc(INBOX.error) + '</div>' : INBOX.rows.length ? '<div class="stack">' + INBOX.rows.map(n => '<button class="listitem" data-notification-action="item" data-id="' + esc(n.id) + '"><div class="row"><b>' + esc(n.title) + '</b>' + (!n.read_at ? '<span class="pill warn">' + tr('새 알림', 'New') + '</span>' : '') + '</div><div class="small" style="white-space:pre-wrap;margin-top:6px">' + esc(n.body) + '</div><div class="tiny muted">' + dateTime(n.created_at) + '</div></button>').join('') + '</div>' : '<p class="empty">' + tr('받은 알림이 없습니다.', 'No notifications yet.') + '</p>');
}
async function openNotificationRoute(route) {
  if (!route) return false;
  if (!S.ctx) { INBOX.pending = route; rememberNotificationRoute(route); return false; }
  if (E && !(await save())) { toast(tr('작성 중인 내용을 저장한 뒤 알림을 열어 주세요.', 'Please save your report before opening the notification.')); return false; }
  if (route.kind !== 'section' && !DEMO.role) {
    const destination = './#' + route.kind + '=' + route.id + (route.comment ? '&comment=' + route.comment : '') + (route.talk ? '&talk=' + route.talk : '');
    if ((await rpc('cellcare_notification_can_open', { p_url: destination })) !== true) {
      toast(tr('삭제되었거나 더 이상 볼 수 없는 알림입니다.', 'This notification is no longer available.')); return false;
    }
  }
  let view;
  if (route.kind === 'report') view = { name: 'detail', id: route.id };
  if (route.kind === 'thread') view = { name: 'thread', id: route.id };
  if (route.kind === 'note' || route.kind === 'notice') view = { name: 'notificationDetail', kind: route.kind, id: route.id };
  if (route.kind === 'section') {
    const tab = availableTabs().find(t => t.id === route.id);
    if (route.id === 'notifications') view = { name: 'notifications' };
    else if (tab) { S.tab = route.id; view = { ...TAB_HOME[route.id] }; }
    else { toast(tr('이 알림을 열 권한이 없습니다.', 'You do not have access to this notification.')); return false; }
  }
  if (!view) return false;
  INBOX.pending = null;
  const url = new URL(location.href); url.searchParams.delete('notification');
  history.replaceState(history.state, '', url.pathname + url.search + url.hash);
  await go(view);
  const anchor = document.getElementById(route.comment ? 'comment-' + route.comment : route.talk ? 'talk-' + route.talk : route.kind + '-' + route.id);
  if (anchor) { anchor.scrollIntoView({ block: 'center' }); anchor.classList.add('notification-highlight'); }
  return true;
}
async function loadCommentReplies(kind, parents) {
  if (DEMO.role || !parents.length) return;
  const rows = await rpc('cellcare_reply_list', { p_kind: kind, p_parents: parents });
  for (const id of parents) INBOX.replyRows[kind + ':' + id] = (rows || []).filter(r => r.parent_id === id);
}
async function viewNotificationDetail(app, v) {
  setTop(v.kind === 'note' ? tr('성도 동정', 'Pastoral note') : tr('공지', 'Notice'), true); renderTabs(true);
  const item = await rpc('cellcare_notification_detail', { p_kind: v.kind, p_id: v.id });
  if (!item) throw new Error(tr('삭제되었거나 볼 수 없는 내용입니다.', 'This item is unavailable.'));
  let comments = '';
  if (v.kind === 'note') {
    const rows = await rpc('note_comments_for', { p_notes: [v.id] });
    NOTE.cmts = { [v.id]: rows || [] };
    await loadCommentReplies('note', (rows || []).map(c => c.id));
    comments = noteComments(item);
  }
  app.innerHTML = '<h1>' + esc(item.title || item.person_name) + '</h1><div id="' + v.kind + '-' + item.id + '" class="card stack"><div class="tiny muted">' + esc(item.author_name) + ' · ' + dateTime(item.created_at) + '</div><div>' + nl2br(item.body || item.content) + '</div>' + (item.prayer ? '<div><b>' + tr('기도제목', 'Prayer') + '</b><div>' + nl2br(item.prayer) + '</div></div>' : '') + comments + '</div>';
}
function replyBlock(kind, parent) {
  const key = kind + ':' + parent;
  return '<div class="comment-replies">' + (INBOX.replyRows[key] || []).map(r => '<div class="note" style="margin:8px 0 8px 16px"><b>' + esc(r.author_name) + '</b><span class="tiny muted"> · ' + dateTime(r.created_at) + '</span><div>' + nl2br(r.content) + '</div>' + (r.mine ? '<button class="link tiny" data-reply-action="delete" data-id="' + r.id + '">' + tr('답글 지우기', 'Delete reply') + '</button>' : '') + '</div>').join('') +
    (INBOX.replyOpen === key ? '<label class="field">' + tr('답글', 'Reply') + '<textarea rows="3" maxlength="3000" data-reply-key="' + key + '">' + esc(INBOX.replyDrafts[key] || '') + '</textarea></label><button class="btn sm" data-reply-action="send" data-kind="' + kind + '" data-parent="' + parent + '" ' + (INBOX.replyBusy ? 'disabled' : '') + '>' + tr('답글 보내기', 'Send reply') + '</button> <button class="link" data-reply-action="cancel">' + tr('취소', 'Cancel') + '</button>' : '<button class="link tiny" data-reply-action="open" data-kind="' + kind + '" data-parent="' + parent + '">' + tr('답글 달기', 'Reply') + '</button>') + '</div>';
}
document.addEventListener('input', e => { if (e.target.dataset.replyKey) INBOX.replyDrafts[e.target.dataset.replyKey] = e.target.value; });
document.addEventListener('click', async e => {
  const n = e.target.closest('[data-notification-action]');
  const r = e.target.closest('[data-reply-action]');
  if (!n && !r) return;
  try {
    if (n) {
      const action = n.dataset.notificationAction;
      if (action === 'open') return go({ name: 'notifications' });
      if (action === 'refresh') return render();
      if (action === 'read-all') { await rpc('cellcare_notification_read', { p_id: null }); INBOX.loadedAt = 0; return render(); }
      if (action === 'item') {
        const row = INBOX.rows.find(x => x.id === n.dataset.id);
        if (!row) return;
        const opened = await openNotificationRoute(CellCareRoutes.parse(row.url));
        if (opened) { await rpc('cellcare_notification_read', { p_id: row.id }); row.read_at = new Date().toISOString(); updateInboxBadge(); }
      }
      return;
    }
    const action = r.dataset.replyAction, key = r.dataset.kind + ':' + r.dataset.parent;
    if (action === 'open') { INBOX.replyOpen = key; return render(); }
    if (action === 'cancel') { INBOX.replyOpen = ''; return render(); }
    if (INBOX.replyBusy) return;
    if (action === 'delete') { if (!confirm(tr('이 답글을 지울까요?', 'Delete this reply?'))) return; await rpc('cellcare_reply_delete', { p_id: r.dataset.id }); return render(); }
    const text = (INBOX.replyDrafts[key] || '').trim();
    if (!text) return toast(tr('답글을 적어 주세요.', 'Please write a reply.'));
    INBOX.replyBusy = true;
    const id = await rpc('cellcare_reply_add', { p_kind: r.dataset.kind, p_parent: r.dataset.parent, p_content: text });
    INBOX.replyDrafts[key] = ''; INBOX.replyOpen = '';
    const { data } = await sb.auth.getSession();
    // 알림 실패와 이미 저장된 답글을 구분해 중복 작성을 막는다.
    try {
      const response = await fetch('api/senior-comment', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (data.session?.access_token || '') }, body: JSON.stringify({ reply: id }) });
      if (!response.ok) throw new Error('notification');
      toast(tr('답글을 보냈습니다.', 'Reply posted.'));
    } catch (_) { toast(tr('답글은 저장됐습니다. 휴대폰 알림은 보내지 못했습니다.', 'Reply saved; push delivery was unsuccessful.')); }
    INBOX.replyBusy = false; await render();
  } catch (err) { toast(errText(err), 5000); }
  finally { INBOX.replyBusy = false; }
});
window.addEventListener('hashchange', () => { const route = CellCareRoutes.parse(location.hash); if (route) openNotificationRoute(route).catch(e => toast(errText(e))); });
if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', e => {
  if (e.data?.type === 'cellcare-notification-open') openNotificationRoute(CellCareRoutes.parse(e.data.url)).catch(err => toast(errText(err)));
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.ctx) refreshInboxBadge(true); });
window.setInterval(() => { if (document.visibilityState === 'visible' && S.ctx) refreshInboxBadge(true); }, 60000);

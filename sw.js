/* 셀 케어 알림 받기용 (화면 저장·오프라인 기능 없음) */
importScripts('notification-route.js');
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (_) { d = { body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(d.title || '셀 케어', {
    body: d.body || '',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    tag: d.tag || 'cellcare',
    renotify: true,
    data: { url: CellCareRoutes.url(d) }
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || './', self.registration.scope);
  const scope = new URL(self.registration.scope);
  const url = target.origin === scope.origin && target.pathname.startsWith(scope.pathname) ? target.href : scope.href;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (c.url.startsWith(self.registration.scope)) {
        c.postMessage({ type: 'cellcare-notification-open', url });
        await c.focus(); return;
      }
    }
    await self.clients.openWindow(url);
  })());
});

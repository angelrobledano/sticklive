/**
 * Service Worker de Stick Live — recepción de Web Push.
 * Smart bundling: el `tag` por partido hace que cada push REEMPLACE la
 * notificación anterior del mismo partido en vez de apilarse.
 */

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload = {};
  try { payload = event.data.json(); } catch { payload = { title: event.data.text() }; }

  const title = payload.title || 'Stick Live';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || '',
      tag: payload.tag || 'sticklive',
      renotify: true,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: payload.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (w.url.startsWith(self.location.origin)) { w.focus(); w.navigate(url); return; }
      }
      return clients.openWindow(url);
    })
  );
});

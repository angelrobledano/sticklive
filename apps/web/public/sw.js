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
      data: { url: payload.url || '/', type: payload.type || 'unknown' },
    })
  );
});

/** Beacon de apertura → /api/push/opened (analítica notification_opened). */
async function reportOpen(data) {
  try {
    const sub = await self.registration.pushManager.getSubscription();
    await fetch(`${self.location.origin}/api/push/opened`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: sub ? sub.endpoint : null,
        type: (data && data.type) || 'unknown',
        url: (data && data.url) || '/',
      }),
      keepalive: true,
    });
  } catch { /* la analítica nunca bloquea la apertura */ }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const url = data.url || '/';
  // Marca la procedencia para atribuir live_match_followed.source = push.
  const target = url + (url.includes('?') ? '&' : '?') + 'src=push';
  event.waitUntil((async () => {
    await reportOpen(data);
    const wins = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (w.url.startsWith(self.location.origin)) { w.focus(); w.navigate(target); return; }
    }
    await clients.openWindow(target);
  })());
});

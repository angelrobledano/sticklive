/**
 * Service Worker de Stick Live — Web Push + capacidad offline/PWA (#343).
 *
 * Estrategia de caché CONSERVADORA (la fuente de verdad con tests vive en
 * `src/lib/pwa.ts`; aquí se replica en vanilla JS porque un SW no importa TS):
 *
 *   · Shell mínimo precacheado: /offline.html + iconos. Sin datos de partidos.
 *   · Navegación (HTML): network-first → caché de páginas → página offline.
 *     Las páginas privadas (settings/login/premium) NO se guardan en caché.
 *   · `/_next/static/**`: cache-first (nombres con hash inmutable).
 *   · Resto de estáticos same-origin: network-first con fallback a caché.
 *   · NUNCA se intercepta: API/SSE, túnel de Sentry (/monitoring), RSC de Next
 *     (?_rsc=), peticiones no-GET y terceros (AdSense/PostHog/Sentry).
 *
 * El nombre de caché lleva versión: al activar se borran las caches antiguas,
 * de modo que un deploy no sirva assets incompatibles.
 */

const VERSION = 'sticklive-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const PAGES_CACHE = `${VERSION}-pages`;
const STATIC_CACHE = `${VERSION}-static`;
const KEEP_CACHES = [SHELL_CACHE, PAGES_CACHE, STATIC_CACHE];

const OFFLINE_URL = '/offline.html';
const PRECACHE_URLS = [OFFLINE_URL, '/icon-192.png', '/icon-512.png'];

/** Rutas same-origin que jamás se cachean (igual que isVolatilePath de pwa.ts). */
function isVolatilePath(pathname) {
  return (
    pathname === '/api' || pathname.startsWith('/api/') ||
    pathname === '/monitoring' || pathname.startsWith('/monitoring/')
  );
}

/** Navegaciones con datos de usuario que no se guardan (igual que pwa.ts). */
const PRIVATE_PAGE_RE = /(?:^|\/)(settings|login|premium)(?:\/|$)/;
function isCacheablePagePath(pathname) {
  return !isVolatilePath(pathname) && !PRIVATE_PAGE_RE.test(pathname);
}

/** Estrategia por petición: 'no-store' | 'navigation' | 'immutable' | 'static'. */
function strategyFor(request, url) {
  if (request.method !== 'GET') return 'no-store';
  if (url.origin !== self.location.origin) return 'no-store';
  if (isVolatilePath(url.pathname)) return 'no-store';
  if ((request.headers.get('accept') || '').includes('text/event-stream')) return 'no-store';
  if (url.search.includes('_rsc=')) return 'no-store';
  if (request.mode === 'navigate') return 'navigation';
  if (url.pathname.startsWith('/_next/static/')) return 'immutable';
  return 'static';
}

/** ¿La respuesta se puede guardar? (ok + no marcada como no-store). */
function isCacheableResponse(res) {
  if (!res || !res.ok) return false;
  return !/no-store/i.test(res.headers.get('cache-control') || '');
}

// ── Ciclo de vida ────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // allSettled: si un icono falta, la instalación NO falla.
    await Promise.allSettled(PRECACHE_URLS.map((u) => cache.add(u)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k.startsWith('sticklive-') && !KEEP_CACHES.includes(k))
        .map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

// ── Fetch ────────────────────────────────────────────────────────────────────
async function networkFirst(request, cacheName, { cacheResponse, offlineFallback }) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (cacheResponse && isCacheableResponse(res)) {
      cache.put(request, res.clone()).catch(() => { /* cuota/opaque: no rompe */ });
    }
    return res;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (offlineFallback) {
      const shell = await caches.open(SHELL_CACHE);
      const offline = await shell.match(OFFLINE_URL);
      if (offline) return offline;
      return new Response('Sin conexión', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
    throw err;
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (isCacheableResponse(res)) {
    cache.put(request, res.clone()).catch(() => { /* noop */ });
  }
  return res;
}

self.addEventListener('fetch', (event) => {
  let url;
  try { url = new URL(event.request.url); } catch { return; }

  const strategy = strategyFor(event.request, url);
  if (strategy === 'no-store') return; // deja que el navegador haga su trabajo

  if (strategy === 'navigation') {
    const cacheResponse = isCacheablePagePath(url.pathname);
    event.respondWith(networkFirst(event.request, PAGES_CACHE, { cacheResponse, offlineFallback: true }));
    return;
  }
  if (strategy === 'immutable') {
    event.respondWith(cacheFirst(event.request, STATIC_CACHE));
    return;
  }
  event.respondWith(networkFirst(event.request, STATIC_CACHE, { cacheResponse: true, offlineFallback: false }));
});

/**
 * Push. Smart bundling: el `tag` por partido hace que cada push REEMPLACE la
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

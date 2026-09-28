import { describe, it, expect } from 'vitest';
import {
  pwaCacheStrategy,
  isVolatilePath,
  isCacheablePagePath,
  type PwaRequestInfo,
} from './pwa';
import { resolveNetworkStatus } from '@/hooks/useNetworkStatus';

/**
 * #343 — capacidad offline/PWA. El Service Worker (public/sw.js) necesita una
 * decisión de estrategia por petición que sea PURA y auditable: qué se cachea
 * (shell mínimo + navegaciones HTML) y qué JAMÁS (API/SSE, túnel de Sentry
 * `/monitoring`, respuestas RSC de Next, datos de páginas privadas). Estas
 * funciones son la fuente de verdad que el SW replica en vanilla JS.
 */

const req = (over: Partial<PwaRequestInfo>): PwaRequestInfo => ({
  url: '/es/matches/ok-liga/foo',
  method: 'GET',
  mode: 'navigate',
  sameOrigin: true,
  accept: '',
  ...over,
});

describe('pwaCacheStrategy — qué hace el SW con cada petición (#343)', () => {
  it('navegación same-origin → network-first con fallback (navigation)', () => {
    expect(pwaCacheStrategy(req({}))).toBe('navigation');
  });

  it('assets inmutables de Next (/_next/static/) → cache-first (immutable)', () => {
    expect(pwaCacheStrategy(req({ url: '/_next/static/chunks/main-abc123.js', mode: 'no-cors' }))).toBe('immutable');
    expect(pwaCacheStrategy(req({ url: '/_next/static/css/app.css', mode: 'cors' }))).toBe('immutable');
  });

  it('resto de estáticos same-origin (imágenes, manifest) → network-first (static)', () => {
    expect(pwaCacheStrategy(req({ url: '/icon-192.png', mode: 'no-cors' }))).toBe('static');
    expect(pwaCacheStrategy(req({ url: '/manifest.webmanifest', mode: 'cors' }))).toBe('static');
  });

  it('NUNCA cachea API same-origin ni el túnel de Sentry', () => {
    expect(pwaCacheStrategy(req({ url: '/api/push/opened', mode: 'cors' }))).toBe('no-store');
    expect(pwaCacheStrategy(req({ url: '/api/matches', mode: 'cors' }))).toBe('no-store');
    expect(pwaCacheStrategy(req({ url: '/monitoring/123', mode: 'cors' }))).toBe('no-store');
  });

  it('NUNCA cachea RSC de Next (?_rsc=) ni streaming SSE', () => {
    expect(pwaCacheStrategy(req({ url: '/es?_rsc=abc', mode: 'cors' }))).toBe('no-store');
    expect(pwaCacheStrategy(req({ url: '/es/live', mode: 'cors', accept: 'text/event-stream' }))).toBe('no-store');
  });

  it('NUNCA toca peticiones que no son GET ni recursos de terceros (AdSense/PostHog/Sentry)', () => {
    expect(pwaCacheStrategy(req({ method: 'POST' }))).toBe('no-store');
    expect(pwaCacheStrategy(req({ url: 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js', sameOrigin: false, mode: 'no-cors' }))).toBe('no-store');
    expect(pwaCacheStrategy(req({ url: 'https://eu.i.posthog.com/e/', sameOrigin: false, mode: 'cors' }))).toBe('no-store');
  });
});

describe('isVolatilePath — rutas que jamás entran en caché', () => {
  it('marca API y monitoring (y sus subrutas)', () => {
    expect(isVolatilePath('/api')).toBe(true);
    expect(isVolatilePath('/api/matches')).toBe(true);
    expect(isVolatilePath('/monitoring')).toBe(true);
    expect(isVolatilePath('/monitoring/envelope')).toBe(true);
  });

  it('no confunde prefijos parecidos ni rutas localizadas', () => {
    expect(isVolatilePath('/apix')).toBe(false);
    expect(isVolatilePath('/es/api')).toBe(false);
    expect(isVolatilePath('/monitoring-station')).toBe(false);
  });
});

describe('isCacheablePagePath — navegaciones con datos de usuario', () => {
  it('no cachea settings/login/premium en ningún idioma', () => {
    expect(isCacheablePagePath('/es/settings')).toBe(false);
    expect(isCacheablePagePath('/en/login')).toBe(false);
    expect(isCacheablePagePath('/premium')).toBe(false);
    expect(isCacheablePagePath('/fr/premium/success')).toBe(false);
  });

  it('sí cachea páginas públicas', () => {
    expect(isCacheablePagePath('/')).toBe(true);
    expect(isCacheablePagePath('/es')).toBe(true);
    expect(isCacheablePagePath('/es/matches/ok-liga/foo')).toBe(true);
    expect(isCacheablePagePath('/es/favorites')).toBe(true);
  });
});

describe('resolveNetworkStatus — normaliza navigator.onLine', () => {
  it('solo `false` explícito cuenta como offline', () => {
    expect(resolveNetworkStatus(false)).toBe(false);
  });

  it('true/undefined/null se tratan como online (SSR-safe)', () => {
    expect(resolveNetworkStatus(true)).toBe(true);
    expect(resolveNetworkStatus(undefined)).toBe(true);
    expect(resolveNetworkStatus(null)).toBe(true);
  });
});

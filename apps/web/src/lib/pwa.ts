'use client';

/**
 * Soporte de instalación PWA.
 *
 * - Registra el Service Worker al cargar (requisito de instalabilidad en Chrome/
 *   Edge/Android y base para Web Push).
 * - Captura `beforeinstallprompt` para poder disparar el diálogo de instalación
 *   nativo desde un botón (los navegadores ya no permiten hacerlo sin gesto).
 * - iOS Safari no soporta este evento: ahí se muestran instrucciones manuales.
 */

import { track, setPersonProps } from '@/lib/analytics';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Plataforma para segmentar el funnel de instalación. */
export function pwaPlatform(): 'ios' | 'android' | 'desktop' {
  if (typeof navigator === 'undefined') return 'desktop';
  const ua = navigator.userAgent || '';
  if (/iphone|ipad|ipod/i.test(ua) || ((navigator as { platform?: string }).platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  if (/android/i.test(ua)) return 'android';
  return 'desktop';
}

let deferred: BeforeInstallPromptEvent | null = null;

/** Desde dónde se pidió instalar (para atribuir `app_installed`). */
export type InstallSource = 'banner' | 'settings';
const SOURCE_KEY = 'sl-install-source';

function rememberSource(source: InstallSource): void {
  try { sessionStorage.setItem(SOURCE_KEY, source); } catch { /* noop */ }
}
function lastSource(): InstallSource | 'browser' {
  try {
    const v = sessionStorage.getItem(SOURCE_KEY);
    return v === 'banner' || v === 'settings' ? v : 'browser';
  } catch { return 'browser'; }
}
let inited = false;

export function initPwa(): void {
  if (inited || typeof window === 'undefined') return;
  inited = true;

  // Registro temprano del SW (instalabilidad + push). Idempotente con enablePush.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* noop */ });
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // evitamos el mini-infobar; lo lanzamos nosotros
    deferred = e as BeforeInstallPromptEvent;
    window.dispatchEvent(new Event('pwa-installable'));
  });

  window.addEventListener('appinstalled', () => {
    deferred = null;
    // `source`: banner / settings, o 'browser' si instaló desde el menú del
    // navegador sin pasar por nuestros botones.
    track('app_installed', { platform: pwaPlatform(), source: lastSource() });
    setPersonProps({ pwa_installed: true });
    window.dispatchEvent(new Event('pwa-installed'));
  });
}

/** ¿Hay un diálogo de instalación nativo disponible ahora mismo? */
export function canInstall(): boolean {
  return deferred !== null;
}

/** Lanza el diálogo nativo de instalación. Devuelve el resultado. */
export async function promptInstall(source: InstallSource = 'settings'): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferred) return 'unavailable';
  const platform = pwaPlatform();
  rememberSource(source);
  track('app_install_prompt_shown', { platform, source });
  await deferred.prompt();
  let outcome: 'accepted' | 'dismissed' = 'dismissed';
  try { outcome = (await deferred.userChoice).outcome; } catch { /* noop */ }
  // Resultado del diálogo nativo: la conversión real del botón «Instalar».
  track('app_install_prompt_result', { platform, source, outcome });
  deferred = null;
  return outcome;
}

/**
 * #343 — Política de caché del Service Worker (offline/PWA).
 *
 * `public/sw.js` es un script clásico que NO puede importar TS: replica estas
 * reglas en vanilla JS. Esta es la fuente de verdad, con tests, para que la
 * decisión "qué se cachea y qué no" no viva solo dentro del SW.
 *
 * Estrategias:
 * - `navigation`: navegación HTML. network-first → caché de páginas → offline.
 * - `immutable`:  `/_next/static/**` (nombres con hash de contenido). cache-first.
 * - `static`:     resto de estáticos same-origin. network-first con fallback.
 * - `no-store`:   no se intercepta ni cachea (API/SSE, observabilidad, RSC, no-GET,
 *                 terceros como AdSense/PostHog/Sentry).
 */
export type PwaStrategy = 'no-store' | 'navigation' | 'immutable' | 'static';

export interface PwaRequestInfo {
  url: string;
  method: string;
  /** `Request.mode` (p. ej. 'navigate', 'cors', 'no-cors', 'same-origin'). */
  mode: string;
  /** ¿La petición es del mismo origen que la app? */
  sameOrigin: boolean;
  /** Cabecera `Accept` (para descartar streaming SSE). */
  accept?: string;
}

/** Rutas same-origin que JAMÁS se cachean: datos volátiles, sensibles u observabilidad. */
export function isVolatilePath(pathname: string): boolean {
  return (
    pathname === '/api' || pathname.startsWith('/api/') ||
    pathname === '/monitoring' || pathname.startsWith('/monitoring/')
  );
}

/** Navegaciones con datos de usuario que no guardamos en la caché de páginas. */
const PRIVATE_PAGE_RE = /(?:^|\/)(settings|login|premium)(?:\/|$)/;

/** ¿Es una navegación cacheable? (fuera de rutas privadas y volátiles). */
export function isCacheablePagePath(pathname: string): boolean {
  if (isVolatilePath(pathname)) return false;
  return !PRIVATE_PAGE_RE.test(pathname);
}

/** Pathname de una URL absoluta o relativa, sin lanzar. */
function pathnameOf(url: string): string {
  try {
    return new URL(url, 'https://sticklive.local').pathname;
  } catch {
    return url;
  }
}

/** Estrategia de caché para una petición concreta. */
export function pwaCacheStrategy(info: PwaRequestInfo): PwaStrategy {
  if (info.method !== 'GET') return 'no-store';
  if (!info.sameOrigin) return 'no-store';
  if (isVolatilePath(pathnameOf(info.url))) return 'no-store';
  // SSE (EventSource) debe llegar directo al servidor, nunca pasar por caché.
  if ((info.accept ?? '').includes('text/event-stream')) return 'no-store';
  // Payload RSC de Next (?_rsc=): datos de navegación, no un documento cacheable.
  if (info.url.includes('_rsc=')) return 'no-store';
  if (info.mode === 'navigate') return 'navigation';
  if (pathnameOf(info.url).startsWith('/_next/static/')) return 'immutable';
  return 'static';
}

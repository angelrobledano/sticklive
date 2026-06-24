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
    track('app_installed', { platform: pwaPlatform() });
    setPersonProps({ pwa_installed: true });
    window.dispatchEvent(new Event('pwa-installed'));
  });
}

/** ¿Hay un diálogo de instalación nativo disponible ahora mismo? */
export function canInstall(): boolean {
  return deferred !== null;
}

/** Lanza el diálogo nativo de instalación. Devuelve el resultado. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferred) return 'unavailable';
  track('app_install_prompt_shown', { platform: pwaPlatform() });
  await deferred.prompt();
  let outcome: 'accepted' | 'dismissed' = 'dismissed';
  try { outcome = (await deferred.userChoice).outcome; } catch { /* noop */ }
  deferred = null;
  return outcome;
}

/**
 * install-prompt.ts — cuándo se ofrece instalar la PWA con el aviso inferior.
 *
 * Reglas (función pura, testeada):
 *  · Solo en móvil. Android solo si el navegador ofrece el diálogo nativo
 *    (`beforeinstallprompt`), iPhone siempre (allí se enseñan los pasos de
 *    «Compartir → Añadir a pantalla de inicio», no hay diálogo).
 *  · Nunca si ya está instalada (modo standalone).
 *  · Nunca a la vez que el aviso de cookies: espera a que se conteste.
 *  · Tras un mínimo de uso (páginas vistas en la sesión): pedir instalar en el
 *    primer segundo convierte peor y molesta.
 *  · Un «Ahora no» lo silencia `DISMISS_DAYS` días.
 */
import type { ConsentState } from '@/lib/consent-tcf';

export type InstallPlatform = 'ios' | 'android' | 'desktop';

/** Días que un «Ahora no» mantiene el aviso oculto. */
export const DISMISS_DAYS = 14;
/** Páginas vistas en la sesión antes de ofrecerlo. */
export const MIN_PAGE_VIEWS = 2;

export const DISMISSED_KEY = 'sl-install-dismissed-at';
export const PAGE_VIEWS_KEY = 'sl-install-page-views';

export interface InstallBannerInput {
  platform: InstallPlatform;
  standalone: boolean;
  hasNativePrompt: boolean;
  consent: ConsentState;
  /** Epoch ms del último «Ahora no», o null. */
  dismissedAt: number | null;
  pageViews: number;
  now: number;
}

export function shouldShowInstallBanner(i: InstallBannerInput): boolean {
  if (i.platform === 'desktop' || i.standalone) return false;
  if (i.platform === 'android' && !i.hasNativePrompt) return false;
  if (i.consent === 'pending') return false;
  if (i.pageViews < MIN_PAGE_VIEWS) return false;
  if (i.dismissedAt != null && i.now - i.dismissedAt < DISMISS_DAYS * 24 * 60 * 60 * 1000) return false;
  return true;
}

/** Lee el último «Ahora no» (localStorage), tolerante a almacén bloqueado. */
export function readDismissedAt(): number | null {
  try {
    const v = Number(localStorage.getItem(DISMISSED_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

export function writeDismissedAt(now: number): void {
  try { localStorage.setItem(DISMISSED_KEY, String(now)); } catch { /* almacén bloqueado */ }
}

/** Suma una página vista en la sesión y devuelve el total. */
export function bumpPageViews(): number {
  try {
    const n = (Number(sessionStorage.getItem(PAGE_VIEWS_KEY)) || 0) + 1;
    sessionStorage.setItem(PAGE_VIEWS_KEY, String(n));
    return n;
  } catch {
    return MIN_PAGE_VIEWS; // sin almacén no podemos contar: no bloqueamos
  }
}

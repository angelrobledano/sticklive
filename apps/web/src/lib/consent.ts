/**
 * Consentimiento de analítica (RGPD/ePrivacy) — lógica pura y testeable.
 *
 * Estado tri-valuado persistido en localStorage bajo `CONSENT_KEY`:
 *   · 'granted' → el usuario aceptó: PostHog puede cargar y persistir.
 *   · 'denied'  → el usuario rechazó: analítica no-op, sin persistencia.
 *   · 'pending' → aún no ha elegido (también valor ausente o corrupto).
 *
 * Sin dependencias: la persistencia acepta un almacenamiento inyectable
 * (por defecto, el `localStorage` del navegador; `null` en SSR).
 */

export type ConsentState = 'granted' | 'denied' | 'pending';

/** Clave de localStorage compartida por lector y banner. */
export const CONSENT_KEY = 'rink-consent-analytics';

/** Evento de ventana para reaccionar al cambio en la misma pestaña. */
export const CONSENT_EVENT = 'rink-consent-change';

/** Subconjunto de `Storage` suficiente para leer/escribir el consentimiento. */
export interface ConsentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Normaliza el valor almacenado: solo 'granted'/'denied' son válidos. */
export function parseConsent(raw: string | null | undefined): ConsentState {
  return raw === 'granted' || raw === 'denied' ? raw : 'pending';
}

/** Serializa el estado para persistirlo. */
export function serializeConsent(state: ConsentState): string {
  return state;
}

/** ¿Puede la analítica cargar y capturar con este estado? */
export function isAnalyticsAllowed(state: ConsentState): boolean {
  return state === 'granted';
}

/** `localStorage` si corremos en el navegador; `null` en SSR o si está bloqueado. */
export function browserStorage(): ConsentStorage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Lee la elección guardada. Ausente, corrupta o inaccesible → 'pending'. */
export function readConsent(storage: ConsentStorage | null = browserStorage()): ConsentState {
  try {
    return parseConsent(storage?.getItem(CONSENT_KEY));
  } catch {
    return 'pending';
  }
}

/** Persiste la elección. Nunca lanza (almacenamiento bloqueado, SSR...). */
export function writeConsent(state: ConsentState, storage: ConsentStorage | null = browserStorage()): void {
  try {
    storage?.setItem(CONSENT_KEY, serializeConsent(state));
  } catch { /* noop */ }
}

/** Notifica en la misma pestaña (el evento `storage` solo cruza pestañas). */
export function emitConsentChange(): void {
  try {
    window.dispatchEvent(new Event(CONSENT_EVENT));
  } catch { /* noop */ }
}

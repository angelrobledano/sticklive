/**
 * Consentimiento de analítica de respaldo.
 *
 * La puerta principal es el CMP de Google (`lib/consent-tcf.ts`). Este módulo
 * solo se usa cuando el CMP no llega a mostrar su mensaje ni a publicar TCData
 * (por ejemplo, una configuración de AdSense pendiente o un bloqueador). En ese
 * caso el aviso de analítica propio sigue disponible para no perder la
 * analítica ni dejar al usuario sin forma de decidir.
 *
 * La elección se guarda en localStorage bajo la misma clave histórica
 * (`rink-consent-analytics`) para no romper a quien ya la tenía.
 */

export type FallbackConsent = 'granted' | 'denied' | 'pending';

export const FALLBACK_CONSENT_KEY = 'rink-consent-analytics';
export const FALLBACK_CONSENT_EVENT = 'rink-consent-fallback-change';
export const FALLBACK_CONSENT_REQUEST_EVENT = 'rink-consent-fallback-request';

/** Normaliza el valor almacenado: solo 'granted'/'denied' son válidos. */
export function parseFallbackConsent(raw: string | null | undefined): FallbackConsent {
  return raw === 'granted' || raw === 'denied' ? raw : 'pending';
}

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Lee la elección de respaldo. Ausente, corrupta o inaccesible → 'pending'. */
export function readFallbackConsent(): FallbackConsent {
  try {
    return parseFallbackConsent(storage()?.getItem(FALLBACK_CONSENT_KEY));
  } catch {
    return 'pending';
  }
}

function emit(): void {
  try {
    window.dispatchEvent(new Event(FALLBACK_CONSENT_EVENT));
  } catch {
    /* noop */
  }
}

/** Persiste una elección de respaldo. Nunca lanza (almacenamiento bloqueado, SSR...). */
export function writeFallbackConsent(state: Exclude<FallbackConsent, 'pending'>): void {
  try {
    storage()?.setItem(FALLBACK_CONSENT_KEY, state);
  } catch {
    /* noop */
  }
  emit();
}

/** Borra la elección de respaldo para volver a preguntar. */
export function resetFallbackConsent(): void {
  try {
    storage()?.removeItem(FALLBACK_CONSENT_KEY);
  } catch {
    /* noop */
  }
  emit();
}

/** Pide al banner de respaldo que se muestre (si la analítica sigue pendiente). */
export function requestFallbackConsent(): void {
  try {
    window.dispatchEvent(new Event(FALLBACK_CONSENT_REQUEST_EVENT));
  } catch {
    /* noop */
  }
}

/**
 * Suscribe a cambios de la elección de respaldo, en la misma pestaña
 * (`FALLBACK_CONSENT_EVENT`) o en otra (`storage`).
 */
export function subscribeFallbackConsent(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === FALLBACK_CONSENT_KEY || event.key === null) listener();
  };
  window.addEventListener(FALLBACK_CONSENT_EVENT, listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(FALLBACK_CONSENT_EVENT, listener);
    window.removeEventListener('storage', onStorage);
  };
}

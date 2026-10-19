/**
 * Consentimiento de analítica: CMP de Google (TCF v2.2) + respaldo.
 *
 * La puerta principal es el CMP certificado de Google (Funding Choices). Se lee
 * su estado con `__tcfapi` y se traduce a una decisión de analítica:
 *
 *   · `gdprApplies === false` → no hace falta consentimiento explícito (fuera
 *     del EEE/UK/CH): analítica permitida.
 *   · `gdprApplies === true` → se exigen los propósitos TCF 1 (almacenar o
 *     acceder a información del dispositivo) y 7 (medir audiencia), que son los
 *     que cubren PostHog.
 *
 * Si el CMP no llega a mostrar su mensaje (configuración de AdSense pendiente,
 * bloqueador, red), se usa el aviso de respaldo de `lib/consent-fallback.ts`
 * para no dejar la analítica sin ninguna forma de consentimiento. El CMP sigue
 * teniendo prioridad: si concede o deniega, su decisión manda.
 *
 * Fail-closed: sin CMP y sin elección de respaldo, PostHog no se inicializa.
 */

import { readFallbackConsent, subscribeFallbackConsent } from '@/lib/consent-fallback';

export type ConsentState = 'granted' | 'denied' | 'pending';

/** Estado del CMP: además de los tres estados, puede no estar disponible. */
export type TcfState = ConsentState | 'unavailable';

/** Estado combinado que consumen la analítica y el aviso de instalación. */
export type AnalyticsConsentState = ConsentState;

export interface TcData {
  gdprApplies?: boolean;
  purposeConsents?: Record<string, boolean>;
  eventStatus?: string;
  displayStatus?: string;
  cmpStatus?: string;
  tcString?: string;
}

type TcfCallback = (data: TcData | null, success: boolean) => void;

interface GoogleFundingChoices {
  showRevocationMessage?: () => void;
}

declare global {
  interface Window {
    __tcfapi?: (
      command: string,
      version: number,
      callback: TcfCallback,
      parameter?: unknown,
    ) => void;
    googlefc?: GoogleFundingChoices;
  }
}

/** ¿El TCData permite la analítica? Pura y testeable. */
export function analyticsAllowedFromTcData(data: TcData | null | undefined): boolean {
  if (!data) return false;
  if (data.gdprApplies === false) return true;
  const purposes = data.purposeConsents ?? {};
  return purposes['1'] === true && purposes['7'] === true;
}

/**
 * Resuelve el estado combinado: una decisión explícita del CMP manda; si el CMP
 * sigue pendiente o no está disponible, se usa la elección de respaldo.
 * Pura y testeable.
 */
export function resolveAnalyticsConsent(
  tcf: TcfState,
  fallback: ConsentState,
): AnalyticsConsentState {
  if (tcf === 'granted' || tcf === 'denied') return tcf;
  return fallback;
}

let state: TcfState = 'pending';
let cmpDisplayStatus: 'visible' | 'hidden' | 'unknown' = 'unknown';
let started = false;
const listeners = new Set<(state: TcfState) => void>();

function setState(next: TcfState): void {
  if (state === next) return;
  state = next;
  for (const listener of listeners) listener(next);
}

function applyTcData(data: TcData | null, success: boolean): void {
  if (!success || !data) return;

  if (data.displayStatus === 'visible' || data.displayStatus === 'hidden') {
    cmpDisplayStatus = data.displayStatus;
  }

  // Mientras el CMP está enseñando su mensaje, no decidimos por él.
  if (data.eventStatus === 'cmpuishown') {
    cmpDisplayStatus = 'visible';
    return;
  }

  // Una elección explícita del usuario (o un TC string ya guardado) manda.
  if (data.eventStatus === 'useractioncomplete' || data.tcString) {
    setState(analyticsAllowedFromTcData(data) ? 'granted' : 'denied');
    return;
  }

  // Fuera del EEE/UK/CH no hace falta consentimiento.
  if (data.gdprApplies === false) {
    setState('granted');
  }
  // Si el CMP está cargado pero aún no hay TCData/elección, seguimos en
  // `pending` para que el aviso de respaldo pueda aparecer.
}

/**
 * Arranca el observador del CMP una sola vez. Espera a `__tcfapi` (el tag de
 * AdSense lo publica), se suscribe a los cambios y lee el estado actual.
 */
export function startConsentWatcher(): void {
  if (started || typeof window === 'undefined') return;
  started = true;

  const start = Date.now();
  const tick = () => {
    const api = window.__tcfapi;
    if (typeof api === 'function') {
      api('addEventListener', 2, (data, success) => applyTcData(data, success));
      api('getTCData', 2, (data, success) => applyTcData(data, success));
      api('ping', 2, (data, success) => {
        if (success && (data?.displayStatus === 'visible' || data?.displayStatus === 'hidden')) {
          cmpDisplayStatus = data.displayStatus;
        }
      });
      return;
    }
    // Sin CMP tras 10 s: no es una denegación, es indisponibilidad. El aviso
    // de respaldo decide.
    if (Date.now() - start > 10_000) {
      setState('unavailable');
      return;
    }
    setTimeout(tick, 250);
  };
  tick();
}

export function getConsentState(): TcfState {
  return state;
}

/** Estado combinado CMP + respaldo. */
export function getAnalyticsConsentState(): AnalyticsConsentState {
  return resolveAnalyticsConsent(state, readFallbackConsent());
}

export function isAnalyticsAllowed(): boolean {
  return getAnalyticsConsentState() === 'granted';
}

export function subscribeConsent(listener: (state: TcfState) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Suscribe a cambios del consentimiento combinado (CMP o respaldo) y notifica
 * solo cuando el estado efectivo cambia.
 */
export function subscribeAnalyticsConsent(
  listener: (state: AnalyticsConsentState) => void,
): () => void {
  let last = getAnalyticsConsentState();
  const notify = () => {
    const next = getAnalyticsConsentState();
    if (next === last) return;
    last = next;
    listener(next);
  };
  const unsubscribeTcf = subscribeConsent(notify);
  const unsubscribeFallback = subscribeFallbackConsent(notify);
  return () => {
    unsubscribeTcf();
    unsubscribeFallback();
  };
}

/** Último `displayStatus` conocido del CMP (o `unknown` si aún no hay ping). */
export function getCmpDisplayStatus(): 'visible' | 'hidden' | 'unknown' {
  return cmpDisplayStatus;
}

/**
 * Pregunta al CMP si su mensaje está visible. Sirve para que el aviso de
 * respaldo no tape el mensaje de Google. Devuelve `unknown` si el CMP no está.
 */
export function probeCmpDisplayStatus(): Promise<'visible' | 'hidden' | 'unknown'> {
  if (typeof window === 'undefined' || typeof window.__tcfapi !== 'function') {
    return Promise.resolve('unknown');
  }
  return new Promise((resolve) => {
    let done = false;
    const finish = (status: 'visible' | 'hidden' | 'unknown') => {
      if (done) return;
      done = true;
      cmpDisplayStatus = status;
      resolve(status);
    };
    const timer = setTimeout(() => finish('unknown'), 1_500);
    try {
      window.__tcfapi?.('ping', 2, (data, success) => {
        clearTimeout(timer);
        if (!success) return finish('unknown');
        const display = data?.displayStatus;
        finish(display === 'visible' || display === 'hidden' ? display : 'unknown');
      });
    } catch {
      clearTimeout(timer);
      finish('unknown');
    }
  });
}

/**
 * Abre el mensaje de consentimiento de Google para revisar o cambiar la
 * elección. `showRevocationMessage` es la API documentada de Funding Choices.
 * Devuelve false si el CMP no está disponible (bloqueado o aún cargando).
 */
export async function openConsentManager(timeoutMs = 4_000): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const googlefc = window.googlefc;
    if (googlefc?.showRevocationMessage) {
      googlefc.showRevocationMessage();
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

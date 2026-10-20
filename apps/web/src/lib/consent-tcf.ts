/**
 * Consentimiento unificado con el CMP de Google (TCF v2.2).
 *
 * El aviso propio de analítica desaparece: el CMP certificado de Google
 * (Funding Choices) es la única puerta. Se lee su estado con `__tcfapi` y se
 * traduce a una decisión de analítica:
 *
 *   · `gdprApplies === false` → no hace falta consentimiento explícito (fuera
 *     del EEE/UK/CH): analítica permitida.
 *   · `gdprApplies === true` → se exigen los propósitos TCF 1 (almacenar o
 *     acceder a información del dispositivo) y 7 (medir audiencia), que son los
 *     que cubren PostHog.
 *
 * Fail-closed: si el CMP no carga (bloqueador, red), el estado se queda en
 * `denied` y no se inicializa PostHog. La UI para cambiar la elección se abre
 * con `openConsentManager()`.
 */

export type ConsentState = 'granted' | 'denied' | 'pending';

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

let state: ConsentState = 'pending';
let started = false;
const listeners = new Set<(state: ConsentState) => void>();

function setState(next: ConsentState): void {
  if (state === next) return;
  state = next;
  for (const listener of listeners) listener(next);
}

function applyTcData(data: TcData | null, success: boolean): void {
  if (!success || !data) return;

  // Mientras el CMP está enseñando su mensaje, no decidimos por él.
  if (data.eventStatus === 'cmpuishown') return;

  // Fuera del EEE/UK/CH no hace falta consentimiento.
  if (data.gdprApplies === false) {
    setState('granted');
    return;
  }

  // Solo decidimos con datos de propósitos. Un TC string sin propósitos aún
  // puede ser un CMP a medio cargar: seguimos en `pending` (fail-closed).
  if (data.purposeConsents && (data.eventStatus === 'useractioncomplete' || data.tcString)) {
    setState(analyticsAllowedFromTcData(data) ? 'granted' : 'denied');
  }
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
      return;
    }
    // Sin CMP tras 10 s: fail-closed (analítica desactivada).
    if (Date.now() - start > 10_000) {
      setState('denied');
      return;
    }
    setTimeout(tick, 250);
  };
  tick();
}

export function getConsentState(): ConsentState {
  return state;
}

export function isAnalyticsAllowed(): boolean {
  return state === 'granted';
}

export function subscribeConsent(listener: (state: ConsentState) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
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

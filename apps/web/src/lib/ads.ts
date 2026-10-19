'use client';

import type { ConsentState } from '@/lib/consent';

/**
 * Anuncios (Google AdSense) — configuración, lógica pura y helpers de cliente.
 *
 * Principio rector: TODO DESACTIVADO POR DEFECTO.
 *   · Sin `NEXT_PUBLIC_ADSENSE_CLIENT` no se carga el script ni se renderiza
 *     ningún anuncio (comportamiento actual intacto).
 *   · Nunca anuncios para usuarios Premium.
 *   · El consentimiento publicitario (RGPD; EEE/UK/Suiza) lo gestiona el CMP
 *     certificado de Google (Funding Choices/TCF), que se sirve a través del
 *     propio tag de AdSense.
 *   · El tag se carga **después de que el usuario responda** al aviso de
 *     analítica (`adsConsentReady`). Es una puerta de rendimiento: no convierte
 *     ese aviso en consentimiento publicitario, que sigue siendo del CMP. Si el
 *     usuario nunca responde, no se descarga AdSense ni se muestra publicidad.
 *
 * La lógica de decisión (`adsEnabled`, `adsConsentReady`,
 * `listAdInsertIndex`, `shouldShowInterstitial`) es PURA y está cubierta por
 * tests. La carga del script es un helper de cliente: solo navegador y nunca
 * lanza.
 */

// ─── Tipos ────────────────────────────────────────────────────────────────────

/** Zonas publicitarias. `interstitial` solo se usa en el overlay no agresivo. */
export type AdZone =
  | 'home-top'
  | 'home-inline'
  | 'list-inline'
  | 'match-summary'
  | 'match-stats'
  | 'interstitial';

export interface AdSenseConfig {
  /** `ca-pub-…`; vacío ⇒ AdSense no configurado. */
  client: string;
  /** Slot de cada zona (las zonas sin slot no muestran anuncio). */
  slots: Partial<Record<AdZone, string>>;
  /** Inserta un banner cada N resultados de lista (`0` lo desactiva). */
  listEvery: number;
  /** Intersticial activado explícitamente (`NEXT_PUBLIC_ADS_INTERSTITIAL=1`). */
  interstitialEnabled: boolean;
}

// ─── Constantes ───────────────────────────────────────────────────────────────

/** Cada cuántos resultados se inserta un banner de lista, por defecto. */
export const LIST_AD_EVERY_DEFAULT = 4;

/** Intervalo mínimo entre intersticiales (frecuencia limitada). */
export const INTERSTITIAL_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Tiempo de interacción en la página antes de poder mostrar el intersticial. */
export const INTERSTITIAL_INTERACTION_MS = 25_000;

// ─── Configuración desde entorno ──────────────────────────────────────────────

/** Variables de entorno que alimentan `buildAdsenseConfig` (inyectables en tests). */
export interface AdsenseEnvInput {
  client?: string | null;
  slotHomeTop?: string | null;
  slotHomeInline?: string | null;
  slotListInline?: string | null;
  slotMatchSummary?: string | null;
  slotMatchStats?: string | null;
  slotInterstitial?: string | null;
  listEvery?: string | null;
  interstitial?: string | null;
}

function clean(value: string | null | undefined): string {
  return (value ?? '').trim();
}

/** `NEXT_PUBLIC_ADS_LIST_EVERY` válido (>= 0) o el valor por defecto. */
function parseListEvery(raw: string | null | undefined): number {
  const n = Number.parseInt(clean(raw), 10);
  if (!Number.isFinite(n)) return LIST_AD_EVERY_DEFAULT;
  return n < 0 ? 0 : n;
}

/** Construye la configuración a partir de valores ya leídos (pura y testeable). */
export function buildAdsenseConfig(env: AdsenseEnvInput = {}): AdSenseConfig {
  const slots: Partial<Record<AdZone, string>> = {};
  const entries: Array<[AdZone, string | null | undefined]> = [
    ['home-top', env.slotHomeTop],
    ['home-inline', env.slotHomeInline],
    ['list-inline', env.slotListInline],
    ['match-summary', env.slotMatchSummary],
    ['match-stats', env.slotMatchStats],
    ['interstitial', env.slotInterstitial],
  ];
  for (const [zone, raw] of entries) {
    const value = clean(raw);
    if (value) slots[zone] = value;
  }
  return {
    client: clean(env.client),
    slots,
    listEvery: parseListEvery(env.listEvery),
    interstitialEnabled: clean(env.interstitial) === '1',
  };
}

/**
 * Lee la configuración de `process.env`. Se accede con claves LITERALES para
 * que Next las sustituya en build (una indexación dinámica no se inyecta).
 */
export function adsenseConfig(): AdSenseConfig {
  return buildAdsenseConfig({
    client: process.env['NEXT_PUBLIC_ADSENSE_CLIENT'],
    slotHomeTop: process.env['NEXT_PUBLIC_ADSENSE_SLOT_HOME_TOP'],
    slotHomeInline: process.env['NEXT_PUBLIC_ADSENSE_SLOT_HOME_INLINE'],
    slotListInline: process.env['NEXT_PUBLIC_ADSENSE_SLOT_LIST_INLINE'],
    slotMatchSummary: process.env['NEXT_PUBLIC_ADSENSE_SLOT_MATCH_SUMMARY'],
    slotMatchStats: process.env['NEXT_PUBLIC_ADSENSE_SLOT_MATCH_STATS'],
    slotInterstitial: process.env['NEXT_PUBLIC_ADSENSE_SLOT_INTERSTITIAL'],
    listEvery: process.env['NEXT_PUBLIC_ADS_LIST_EVERY'],
    interstitial: process.env['NEXT_PUBLIC_ADS_INTERSTITIAL'],
  });
}

// ─── Lógica pura ──────────────────────────────────────────────────────────────

export interface AdsEnabledInput {
  /** Cliente AdSense configurado (`ca-pub-…`); vacío ⇒ desactivado. */
  client?: string | null;
  premium: boolean;
}

/**
 * ¿Se puede mostrar un anuncio? Cliente configurado y usuario no Premium.
 * El consentimiento y el tipo de anuncio (personalizado/no personalizado) los
 * decide el CMP de Google (TCF) dentro del propio tag de AdSense, no esta capa.
 */
export function adsEnabled({ client, premium }: AdsEnabledInput): boolean {
  return clean(client).length > 0 && !premium;
}

/**
 * ¿Ha respondido ya el usuario al aviso de analítica?
 *
 * Se usa solo como puerta de carga de AdSense: `granted` y `denied` son ambos
 * una respuesta; `pending` (o `null` antes de montar) mantiene el tag fuera del
 * navegador. El consentimiento publicitario lo decide el CMP de Google.
 */
export function adsConsentReady(state: ConsentState | null): boolean {
  return state === 'granted' || state === 'denied';
}

/**
 * Posición (índice 0-based de inserción) de un banner entre resultados: tras
 * `every` elementos. Devuelve `-1` si no procede (lista demasiado corta, el
 * banner quedaría al final, o intervalo inválido). `every` por defecto 4.
 */
export function listAdInsertIndex(itemCount: number, every: number = LIST_AD_EVERY_DEFAULT): number {
  if (!Number.isFinite(itemCount) || itemCount <= 0) return -1;
  if (!Number.isFinite(every) || every < 1) return -1;
  const step = Math.floor(every);
  if (step < 1 || itemCount <= step) return -1;
  return step;
}

export interface InterstitialInput {
  enabled: boolean;
  premium: boolean;
  alreadyShownThisSession: boolean;
  lastShownAt?: number | null;
  nowMs: number;
  minIntervalMs?: number;
}

/**
 * Decisión pura del intersticial con frecuencia limitada: máximo uno por
 * sesión y, además, un intervalo mínimo desde el último mostrado (6 h por
 * defecto). `lastShownAt` inválido se trata como "nunca mostrado".
 */
export function shouldShowInterstitial(input: InterstitialInput): boolean {
  if (!input.enabled || input.premium) return false;
  if (input.alreadyShownThisSession) return false;
  const min = Number.isFinite(input.minIntervalMs)
    ? (input.minIntervalMs as number)
    : INTERSTITIAL_MIN_INTERVAL_MS;
  const last = input.lastShownAt;
  if (last != null && Number.isFinite(last) && input.nowMs - last < min) return false;
  return true;
}

// ─── Helpers de cliente ───────────────────────────────────────────────────────

/** Id del `<script>` de AdSense (para la carga idempotente). */
export const ADSENSE_SCRIPT_ID = 'adsbygoogle-js';

let adsenseScriptRequested = false;

/**
 * Inyecta `adsbygoogle.js` UNA sola vez (idempotente entre montajes/HMR).
 * Sin cliente, sin documento (SSR) o si ya está presente → `false` sin tocar el
 * DOM. Devuelve `true` solo cuando acaba de inyectar el script.
 */
export function loadAdsenseScript(client: string): boolean {
  const id = clean(client);
  if (!id || typeof document === 'undefined') return false;
  if (adsenseScriptRequested || document.getElementById(ADSENSE_SCRIPT_ID)) return false;
  adsenseScriptRequested = true;
  try {
    const script = document.createElement('script');
    script.id = ADSENSE_SCRIPT_ID;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.src =
      `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(id)}`;
    document.head.appendChild(script);
    return true;
  } catch {
    adsenseScriptRequested = false; // permite reintentar en el siguiente intento
    return false;
  }
}


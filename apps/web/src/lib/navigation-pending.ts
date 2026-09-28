/**
 * #345 — Indicador global de navegación pendiente, SIN Suspense de ruta.
 *
 * Contexto: en `matches/[id]`, `teams/[id]` y `players/[id]` NO se pueden añadir
 * `loading.tsx`. Un `loading.tsx` crea un límite de Suspense: Next empieza a
 * streamear el fallback con status 200 y, cuando el Server Component lanza
 * `notFound()`, el 404 real ya no se puede fijar → vuelven los soft‑404 que
 * arregló #168 (borrado de esos ficheros). Sigue vigente en Next 16.
 *
 * Alternativa: feedback 100% en cliente, sin envolver el segmento de ruta ni
 * tocar el status HTTP. Este módulo concentra la lógica PURA (sin React ni DOM)
 * para poder fijarla con tests; el componente que la usa es
 * `components/layout/NavigationProgress.tsx`.
 */

export interface PendingState {
  /** Hay una navegación cliente en curso. */
  pending: boolean;
  /** URL destino (href absoluto) que originó el estado, para trazabilidad. */
  url: string | null;
  /** ms epoch en que empezó. */
  startedAt: number | null;
}

export const IDLE: PendingState = { pending: false, url: null, startedAt: null };

export type PendingEvent =
  | { type: 'start'; url: string; at: number }
  | { type: 'settle' }
  | { type: 'timeout' };

/**
 * Reducer puro. `start` enciende el indicador; `settle` (la ruta destino ya
 * llegó) y `timeout` (red/API colgada) lo apagan. Se apaga siempre al mismo
 * estado IDLE para no dejar la barra "colgada".
 */
export function reducePending(state: PendingState, event: PendingEvent): PendingState {
  switch (event.type) {
    case 'start':
      return { pending: true, url: event.url, startedAt: event.at };
    case 'settle':
    case 'timeout':
      return IDLE;
    default:
      return state;
  }
}

/** Datos de un click sobre un `<a>`, desacoplados del DOM para poder testarlos. */
export interface ClickInfo {
  /** `href` del enlace (puede ser relativo). */
  href: string;
  target?: string | null;
  download?: boolean;
  /** true si el click trae meta/ctrl/shift/alt (abrir en pestaña/ventana nueva). */
  modifier?: boolean;
  /** `MouseEvent.button` (0 = principal). */
  button?: number;
  /** Origen actual (`window.location.origin`). */
  origin: string;
  /** URL completa actual (`window.location.href`). */
  currentHref: string;
}

/**
 * ¿Este click inicia una navegación cliente que merece feedback? Se excluyen
 * los clicks que no navegan por la app: botón no principal, modificadores,
 * `target` distinto de `_self`, descargas, enlaces externos, protocolos no
 * http(s) y destinos idénticos a la página actual (mismo path y query, o solo
 * un salto de ancla), que no muestran contenido nuevo.
 */
export function shouldStartPending(info: ClickInfo): boolean {
  if (info.button !== undefined && info.button !== 0) return false;
  if (info.modifier) return false;
  if (info.download) return false;
  if (info.target && info.target !== '_self') return false;

  let next: URL;
  let current: URL;
  try {
    current = new URL(info.currentHref, info.origin);
    next = new URL(info.href, current);
  } catch {
    return false;
  }

  if (next.origin !== current.origin) return false;
  if (next.protocol !== 'http:' && next.protocol !== 'https:') return false;

  // Misma ruta y query → no hay contenido nuevo que cargar.
  if (next.pathname === current.pathname && next.search === current.search) return false;

  return true;
}

/** Retraso mínimo (ms) antes de pintar: evita el "flash" en navegaciones rápidas/cacheadas. */
export const PENDING_DELAY_MS = 150;

/**
 * La barra no puede quedarse colgada si la navegación nunca termina (p. ej.
 * API caída durante el fetch del Server Component en la ruta destino).
 */
export const PENDING_TIMEOUT_MS = 10_000;

/** ¿Toca pintar el indicador? Solo si hay navegación y ya pasó el retraso mínimo. */
export function shouldRenderPending(
  state: PendingState,
  now: number,
  delayMs: number = PENDING_DELAY_MS,
): boolean {
  if (!state.pending || state.startedAt === null) return false;
  return now - state.startedAt >= delayMs;
}

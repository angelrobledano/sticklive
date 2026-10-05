import type { MatchDetail } from './api/types';

export type Transport = 'sse' | 'poll';

export interface MatchState {
  detail: MatchDetail | null;
  connected: boolean;
  transport: Transport;
  /** Desfase del stream: el hub avisó con `event: stale` (poll del servidor caído, #284). */
  stale: boolean;
  /** Instante (client-side) en que llegó el aviso de desfase, para el "hace N s". */
  staleAt: number | null;
}

/**
 * Parches que el hook (`useMatchLive`) traduce de los eventos SSE.
 *
 * Protocolo REAL verificado en `apps/api/src/routes/match-stream.ts` y
 * `apps/api/src/lib/sse-hub.ts`: el primer envío llega como `event: snapshot`
 * y los siguientes como `event: update`, pero en AMBOS casos el payload es el
 * DTO completo del partido (el hub re-serializa el snapshot entero,
 * sse-hub.ts:97) más `updatedAt`. No existe un delta `{ match, newEvents }`.
 * Además el hub emite `event: stale` con `{ stale, updatedAt }` cuando su poll
 * interno falla (y `stale: false` al recuperar, seguido del fanout normal).
 */
export type StreamPatch =
  | { kind: 'snapshot'; detail: MatchDetail }
  | { kind: 'update'; detail: MatchDetail }
  | { kind: 'transport'; transport: Transport }
  | { kind: 'stale'; staleAt: number };

/** Backoff exponencial 1s, 2s, 4s... tope 30s. */
export function backoffDelay(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 30_000);
}

/**
 * Reducer puro del estado de la ficha a partir de los parches del stream.
 *
 * `snapshot` y `update` comparten semántica a propósito: reemplazo en bloque
 * del DTO. Es lo único que refleja fielmente las correcciones de acta (#177:
 * un evento puede sustituirse por otro sin cambiar el conteo) y los borrados;
 * un merge por id congelaría los datos corregidos.
 */
export function applyStreamPatch(state: MatchState, patch: StreamPatch): MatchState {
  switch (patch.kind) {
    case 'snapshot':
    case 'update':
      // Datos frescos: cualquier desfase previo queda limpiado.
      return { ...state, detail: patch.detail, connected: true, stale: false, staleAt: null };
    case 'transport':
      // Conserva el último detalle en pantalla durante la degradación.
      return { ...state, transport: patch.transport, connected: false };
    case 'stale':
      // El canal SSE sigue abierto: lo congelado son los datos, no el transporte.
      return { ...state, stale: true, staleAt: patch.staleAt };
  }
}

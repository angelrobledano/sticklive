/**
 * Lógica pura del hub SSE de partidos (`routes/match-stream.ts`).
 *
 * El hub mantiene, por partido, el último snapshot enviado y decide cuándo hay
 * que hacer fan-out a los suscriptores. Esa decisión (primer envío / cambio de
 * eventos / marcador / fase) y el nombre del evento SSE son lógica sin I/O, así
 * que viven aquí para poder testearlas sin BD ni temporizadores (issue #183).
 */

export type SseKind = 'data' | 'finished' | 'error';

/** Estado acumulado de un hub entre polls. */
export interface HubState {
  lastEventCount: number;
  /**
   * Huella EXACTA del listado de eventos (no sólo su número). Una corrección de
   * acta puede sustituir un evento por otro en el mismo ciclo: el conteo y el
   * marcador no cambian, pero el listado sí, y el fan-out debe dispararse sin
   * esperar al poll de respaldo de 60 s (#177). Se usa el JSON serializado en vez
   * de un hash para no introducir colisiones.
   */
  lastEventsKey: string | null;
  /**
   * Huella del listado de alineaciones. Un gol puede actualizar los goles y
   * asistencias por jugador sin que cambien el marcador ni el listado de
   * eventos; sin esta huella el fan-out no se disparaba y el goleador tardaba
   * hasta el TTL de alineaciones en reflejarse (#376).
   */
  lastLineupsKey: string | null;
  lastHome: number | null;
  lastAway: number | null;
  lastPhase: string | null;
  lastSnapshotJson: string | null;
}

/** Subconjunto del snapshot que decide si hay cambios que emitir. */
export interface HubSnapshotInput {
  match: {
    status: string;
    score: { home: number | null; away: number | null };
    live: { isHalftime?: boolean | null; period?: number | null } | null;
  };
  events: readonly unknown[];
  /** Alineaciones del snapshot; opcional para no romper consumidores/tests. */
  lineups?: unknown;
}

export interface SnapshotDiff {
  /** true si procede emitir el snapshot (primer envío o algún cambio). */
  changed: boolean;
  /** true si el listado de eventos cambió (nuevo gol, corrección de acta…). */
  eventsChanged: boolean;
  /** Snapshot serializado, para enviar y guardar. */
  json: string;
  /** Estado actualizado. */
  state: HubState;
}

/** Estado inicial de un hub recién suscrito (antes del primer poll). */
export function emptyHubState(): HubState {
  return {
    lastEventCount: -1,
    lastEventsKey: null,
    lastLineupsKey: null,
    lastHome: -1,
    lastAway: -1,
    lastPhase: null,
    lastSnapshotJson: null,
  };
}

/**
 * Aplica un snapshot al estado del hub y decide si hay que emitirlo.
 *
 * Cambios que cuentan como "nuevo": primer snapshot, nº de eventos, contenido
 * de eventos, alineaciones (goles/asistencias), marcador (local/visitante) o
 * fase (`status | descanso | periodo`). El cambio de fase permite reflejar el
 * descanso en tiempo real aunque no cambie el marcador.
 */
export function applySnapshot(state: HubState, snapshot: HubSnapshotInput): SnapshotDiff {
  const eventsKey = JSON.stringify(snapshot.events);
  const lineupsKey = JSON.stringify(snapshot.lineups ?? null);
  // Cubre tanto un evento nuevo/eliminado (cuenta distinta) como una corrección
  // que sustituye un evento sin alterar el nº (#177).
  const evChanged = eventsKey !== state.lastEventsKey;
  // #376: una asistencia nueva cambia las alineaciones sin tocar eventos ni
  // marcador; sin compararlas, el fan-out no se disparaba.
  const lineupsChanged = lineupsKey !== state.lastLineupsKey;
  const scoreChanged =
    snapshot.match.score.home !== state.lastHome ||
    snapshot.match.score.away !== state.lastAway;
  const lv = snapshot.match.live;
  const phaseKey = `${snapshot.match.status}|${lv?.isHalftime ?? ''}|${lv?.period ?? ''}`;
  const phaseChanged = phaseKey !== state.lastPhase;
  const first = state.lastSnapshotJson === null;

  const json = JSON.stringify(snapshot);
  const next: HubState = {
    lastEventCount: snapshot.events.length,
    lastEventsKey: eventsKey,
    lastLineupsKey: lineupsKey,
    lastHome: snapshot.match.score.home,
    lastAway: snapshot.match.score.away,
    lastPhase: phaseKey,
    lastSnapshotJson: json,
  };

  return {
    changed: first || evChanged || lineupsChanged || scoreChanged || phaseChanged,
    eventsChanged: evChanged,
    json,
    state: next,
  };
}

/**
 * Nombre del evento SSE para un tipo de fan-out. El primer `data` es
 * `snapshot` (estado completo) y los siguientes `update`; `finished` y `error`
 * pasan tal cual. Devuelve también el flag `firstSent` actualizado.
 */
export function eventForKind(
  kind: SseKind,
  firstSent: boolean,
): { event: string; firstSent: boolean } {
  if (kind === 'error') return { event: 'error', firstSent };
  if (kind === 'finished') return { event: 'finished', firstSent };
  return firstSent ? { event: 'update', firstSent: true } : { event: 'snapshot', firstSent: true };
}

/**
 * Encoda una entrada en la cola SSE de una conexión con tope (#333).
 *
 * `writeSSE` es backpressure real: si un cliente lento no consume, la cola
 * crecía sin límite y podía tumbar el proceso. Al tope, se descarta el evento
 * MÁS ANTIGUO (el cliente ya no está al día; lo nuevo es lo relevante).
 */
export function enqueueBounded<T>(queue: T[], item: T, max: number): void {
  const limit = Number.isFinite(max) && max >= 1 ? Math.floor(max) : 1;
  while (queue.length >= limit) queue.shift();
  queue.push(item);
}

/**
 * Payload del evento `error` cuando el partido no existe. Unifica la forma con
 * el resto de errores SSE/REST (`{ error: 'not_found' }`), en vez de un
 * `{ message }` suelto (#333).
 */
export const SSE_NOT_FOUND_ERROR = { error: 'not_found', message: 'Partido no encontrado' } as const;


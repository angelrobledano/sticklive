/**
 * Actas que solo se publican al final (#417). Puro y testeado.
 *
 * En categorías de base (FECAPA, FPCV, FMP…) la ficha no trae cronología
 * durante el partido: se rellena al acabar o nunca. Antes se pedía cada
 * minuto (cron-live) y, terminado sin eventos, hasta 48 h. Ahora:
 *  · se aprende por competición si el acta llega en directo ('live') o solo
 *    al final ('post'), observando directos con goles;
 *  · en 'post' la ficha de un directo se pide cada 15 min (latido: sirve para
 *    volver a aprender y para el final por acta; el marcador llega por el mc);
 *  · un terminado sin acta se pide seguido unas veces, luego cada 15 min, y
 *    se deja tras un tope.
 */
export type ActaMode = 'live' | 'post' | null;

/** Directos con goles y ficha vacía necesarios para marcar «solo al final». */
export const ACTA_POST_STRIKES = 3;
/** Intervalo del latido y de los reintentos espaciados. */
export const SLOW_FETCH_MS = 15 * 60_000;
/** Intentos seguidos (cada ciclo) antes de espaciar un terminado sin acta. */
export const FAST_EMPTY_TRIES = 3;
/** Intentos vacíos tras los que se deja de pedir un terminado (~2 h espaciados). */
export const MAX_EMPTY_TRIES = 12;

export function learnActaMode(
  prev: { mode: ActaMode; strikes: number },
  obs: { status: string; goals: number; events: number },
): { mode: ActaMode; strikes: number } {
  if (obs.status !== 'live') return prev;
  if (obs.events > 0) return { mode: 'live', strikes: 0 };
  if (obs.goals <= 0) return prev; // 0-0 sin eventos no prueba nada
  const strikes = prev.strikes + 1;
  return { mode: strikes >= ACTA_POST_STRIKES ? 'post' : prev.mode, strikes };
}

export function shouldFetchFicha(
  m: { status: string; mode: ActaMode; fetchedAt: Date | null; emptyChecks: number },
  now: Date = new Date(),
): boolean {
  const since = m.fetchedAt ? now.getTime() - m.fetchedAt.getTime() : Infinity;
  if (m.status === 'live') return m.mode !== 'post' || since >= SLOW_FETCH_MS;
  if (m.emptyChecks >= MAX_EMPTY_TRIES) return false;
  if (m.emptyChecks < FAST_EMPTY_TRIES) return true;
  return since >= SLOW_FETCH_MS;
}

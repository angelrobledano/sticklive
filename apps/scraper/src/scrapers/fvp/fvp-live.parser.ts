/**
 * Parser puro del feed de marcadores de la Federación Vasca
 * (`/public/partidos/marcadores`): UNA llamada con todos los partidos de la
 * jornada de todo el hockey vasco y la Liga Norte, agrupados por competición.
 *
 * `periodo` es la única señal de estado (observado el 23/10/2026 con partidos
 * en juego): 0 = sin empezar, 1-2 = parte en juego (3-4 = prórroga),
 * 9 = descanso (tras la 1ª parte, crono a cero y parado), 30 = terminado.
 * Cualquier otro valor NO toca el partido y se reporta.
 */

export type FvpLiveState = 'scheduled' | 'live' | 'halftime' | 'finished' | 'unknown';

export interface FvpLiveItem {
  matchId: string;
  competitionName: string;
  state: FvpLiveState;
  /** Valor crudo de `periodo` (para los avisos de estado desconocido). */
  rawPeriod: number | null;
  period: number | null;
  homeScore: number | null;
  awayScore: number | null;
  /** Deporte escolar: la federación oculta el marcador (no se publica). */
  hiddenScore: boolean;
  actaClosed: boolean;
}

type Json = Record<string, unknown>;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export const FVP_FINISHED_PERIOD = 30;
export const FVP_HALFTIME_PERIOD = 9;

export function stateOfPeriod(p: number | null): FvpLiveState {
  if (p === 0) return 'scheduled';
  if (p !== null && p >= 1 && p <= 4) return 'live';
  if (p === FVP_HALFTIME_PERIOD) return 'halftime';
  if (p === FVP_FINISHED_PERIOD) return 'finished';
  return 'unknown';
}

export function parseFvpMarcadores(raw: unknown): FvpLiveItem[] {
  if (!Array.isArray(raw)) throw new Error('FVP marcadores: la respuesta no es una lista');
  const out: FvpLiveItem[] = [];
  for (const comp of raw as Json[]) {
    const matches = comp['matches'];
    if (!Array.isArray(matches)) throw new Error('FVP marcadores: competición sin "matches"');
    for (const m of matches as Json[]) {
      const id = typeof m['id'] === 'string' ? m['id'] : null;
      if (!id) continue;
      const rawPeriod = num(m['periodo']);
      const hidden = m['marcadorACero'] === true;
      const local = (m['local'] ?? {}) as Json;
      const visit = (m['visitante'] ?? {}) as Json;
      const state = stateOfPeriod(rawPeriod);
      out.push({
        matchId: id,
        competitionName: typeof comp['competicionNombre'] === 'string' ? comp['competicionNombre'] : '',
        state,
        rawPeriod,
        period: state === 'live' ? rawPeriod : state === 'halftime' ? 1 : null,
        homeScore: hidden ? null : num(local['goles']),
        awayScore: hidden ? null : num(visit['goles']),
        hiddenScore: hidden,
        actaClosed: m['actaCerrada'] === true,
      });
    }
  }
  return out;
}

/** Crono del acta (`/public/partidos/{id}`): restante de la parte y si corre. */
export function clockOfActa(raw: unknown): { period: number | null; seconds: number | null; running: boolean } {
  const p = (raw ?? {}) as Json;
  const period = num(p['periodo']);
  const min = num(p['cronoMin']);
  const sec = num(p['cronoSec']);
  return {
    period: period !== null && period >= 1 && period <= 4 ? period : null,
    seconds: min !== null && sec !== null ? min * 60 + sec : null,
    running: p['cronoEnMarcha'] === true,
  };
}

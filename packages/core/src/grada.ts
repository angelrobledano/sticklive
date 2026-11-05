import type { MatchSummary } from './api';
import { madridDateKey } from './match-time';

/**
 * #263 "Mi grada" — selección PURA de próximos partidos y últimos resultados de
 * los equipos y ligas seguidos.
 *
 * Se apoya en la lista de partidos que la home ya carga en servidor
 * (`/matches/current`, ventana hoy−8 … hoy+15), de modo que no hay que hacer un
 * fetch por equipo. "Hoy" se compara en clave de día de Europe/Madrid
 * (`madridDateKey`), igual que el resto de la app, para no desajustar
 * servidor/cliente en la hidratación.
 */

export interface GradaInput {
  /** Ids de equipos seguidos. */
  teamIds: string[];
  /** Ids de competiciones/ligas seguidas. */
  leagueIds: string[];
  /** Día de "hoy" en Europe/Madrid (YYYY-MM-DD). */
  todayKey: string;
  /** Máximo de partidos devueltos por lista. */
  limit?: number;
}

export interface GradaSelection<T extends MatchSummary = MatchSummary> {
  /** Partidos que aún no han terminado, en orden cronológico ascendente. */
  upcoming: T[];
  /** Partidos terminados, del más reciente al más antiguo. */
  results: T[];
}

const DEFAULT_LIMIT = 4;

/** Instante del partido (o 0 si falta / es inválido) para ordenar de forma estable. */
function timeOf(m: MatchSummary): number {
  const iso = m.scheduledAt ?? m.startedAt;
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

/**
 * ¿Es un partido "próximo" de la grada?
 *  - `scheduled`/`postponed` si su día (Madrid) es hoy o posterior.
 *  - `live`, `finished` y `cancelled` nunca: los directos viven en la banda/tira.
 */
export function isUpcomingMatch(m: MatchSummary, todayKey: string): boolean {
  if (m.status === 'finished' || m.status === 'cancelled' || m.status === 'live') return false;
  const day = madridDateKey(m.scheduledAt ?? m.startedAt);
  // Sin fecha no lo mostramos como próximo (no sabemos cuándo es).
  if (!day) return false;
  return day >= todayKey;
}

/**
 * Filtra los partidos que pertenecen a la grada del usuario (equipo seguido en
 * cualquier bando, o competición seguida) y los reparte en próximos/resultados,
 * ordenados y recortados a `limit`.
 */
export function selectGradaMatches<T extends MatchSummary>(
  matches: T[],
  input: GradaInput,
): GradaSelection<T> {
  const teams = new Set(input.teamIds);
  const leagues = new Set(input.leagueIds);
  const limit = input.limit ?? DEFAULT_LIMIT;

  const upcoming: T[] = [];
  const results: T[] = [];

  for (const m of matches) {
    // La API cruda (app) no envía homeTeamId/awayTeamId: se cae a homeTeam.id/awayTeam.id.
    const homeId = m.homeTeamId ?? m.homeTeam?.id;
    const awayId = m.awayTeamId ?? m.awayTeam?.id;
    const followed =
      (!!homeId && teams.has(homeId)) ||
      (!!awayId && teams.has(awayId)) ||
      (!!m.competitionId && leagues.has(m.competitionId));
    if (!followed) continue;

    if (m.status === 'finished') {
      results.push(m);
    } else if (isUpcomingMatch(m, input.todayKey)) {
      upcoming.push(m);
    }
  }

  upcoming.sort((a, b) => timeOf(a) - timeOf(b));
  results.sort((a, b) => timeOf(b) - timeOf(a));

  return { upcoming: upcoming.slice(0, limit), results: results.slice(0, limit) };
}

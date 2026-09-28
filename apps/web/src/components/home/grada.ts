import type { Match } from '@/lib/api/client';
import { madridDateKey } from '@/lib/match-time';

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

export interface GradaSelection {
  /** Partidos que aún no han terminado, en orden cronológico ascendente. */
  upcoming: Match[];
  /** Partidos terminados, del más reciente al más antiguo. */
  results: Match[];
}

const DEFAULT_LIMIT = 4;

/** Instante del partido (o 0 si falta / es inválido) para ordenar de forma estable. */
function timeOf(m: Match): number {
  const iso = m.scheduledAt ?? m.startedAt;
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

/**
 * ¿Es un partido "próximo" de la grada?
 *  - `live` siempre (se está jugando ahora).
 *  - `scheduled`/`postponed` si su día (Madrid) es hoy o posterior.
 *  - `finished` y `cancelled` nunca.
 */
export function isUpcomingMatch(m: Match, todayKey: string): boolean {
  if (m.status === 'finished' || m.status === 'cancelled') return false;
  if (m.status === 'live') return true;
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
export function selectGradaMatches(matches: Match[], input: GradaInput): GradaSelection {
  const teams = new Set(input.teamIds);
  const leagues = new Set(input.leagueIds);
  const limit = input.limit ?? DEFAULT_LIMIT;

  const upcoming: Match[] = [];
  const results: Match[] = [];

  for (const m of matches) {
    const followed =
      teams.has(m.homeTeamId) ||
      teams.has(m.awayTeamId) ||
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

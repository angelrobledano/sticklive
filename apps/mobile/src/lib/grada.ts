import type { MatchSummary } from './api/types';

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
  upcoming: MatchSummary[];
  /** Partidos terminados, del más reciente al más antiguo. */
  results: MatchSummary[];
}

const DEFAULT_LIMIT = 4;

/** Convierte una fecha ISO a la clave YYYY-MM-DD en Europe/Madrid. */
export function madridDateKey(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  // Intl format en Europe/Madrid
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(d);
}

function timeOf(m: MatchSummary): number {
  const iso = m.scheduledAt;
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

export function isUpcomingMatch(m: MatchSummary, todayKey: string): boolean {
  if (m.status === 'finished' || m.status === 'cancelled' || m.status === 'live') {
    return false;
  }
  const day = madridDateKey(m.scheduledAt);
  if (!day) return false;
  return day >= todayKey;
}

export function selectGradaMatches(matches: MatchSummary[], input: GradaInput): GradaSelection {
  const teams = new Set(input.teamIds);
  const leagues = new Set(input.leagueIds);
  const limit = input.limit ?? DEFAULT_LIMIT;

  const upcoming: MatchSummary[] = [];
  const results: MatchSummary[] = [];

  for (const m of matches) {
    const followed =
      teams.has(m.homeTeam.id) ||
      teams.has(m.awayTeam.id) ||
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

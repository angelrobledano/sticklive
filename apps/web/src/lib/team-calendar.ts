/**
 * Calendario de un equipo: resultado desde su punto de vista y filtros
 * (jugados/próximos, casa/fuera, resultado). Puro y testeable.
 */
import type { TeamMatchSummary } from './api/types';

export type TeamResult = 'W' | 'D' | 'L';

export interface CalendarFilter {
  status?: 'all' | 'played' | 'upcoming';
  venue?: 'all' | 'home' | 'away';
  result?: 'all' | TeamResult;
}

const PLAYED = new Set(['finished', 'live']);

export function teamResult(teamId: string, m: TeamMatchSummary): TeamResult | null {
  if (m.status !== 'finished') return null;
  if (m.winnerTeamId) return m.winnerTeamId === teamId ? 'W' : 'L';
  const home = m.homeTeam.id === teamId;
  const mine = home ? m.score.home : m.score.away;
  const theirs = home ? m.score.away : m.score.home;
  if (mine == null || theirs == null) return null;
  return mine > theirs ? 'W' : mine < theirs ? 'L' : 'D';
}

export function filterTeamMatches(matches: TeamMatchSummary[], teamId: string, f: CalendarFilter): TeamMatchSummary[] {
  return matches.filter((m) => {
    if (f.status === 'played' && !PLAYED.has(m.status)) return false;
    if (f.status === 'upcoming' && PLAYED.has(m.status)) return false;
    const home = m.homeTeam.id === teamId;
    if (f.venue === 'home' && !home) return false;
    if (f.venue === 'away' && home) return false;
    if (f.result && f.result !== 'all' && teamResult(teamId, m) !== f.result) return false;
    return true;
  });
}

export function calendarCounts(matches: TeamMatchSummary[], teamId: string) {
  const c = { all: matches.length, played: 0, upcoming: 0, home: 0, away: 0, W: 0, D: 0, L: 0 };
  for (const m of matches) {
    if (PLAYED.has(m.status)) c.played++; else c.upcoming++;
    if (m.homeTeam.id === teamId) c.home++; else c.away++;
    const r = teamResult(teamId, m);
    if (r) c[r]++;
  }
  return c;
}

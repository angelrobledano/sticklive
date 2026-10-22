import { describe, it, expect } from 'vitest';
import { filterTeamMatches, teamResult, calendarCounts } from './team-calendar';
import type { TeamMatchSummary } from './api/types';

const T = 'me';
let n = 0;
const m = (home: boolean, status: string, my: number | null, opp: number | null, extra: Partial<TeamMatchSummary> = {}): TeamMatchSummary => ({
  id: `m${++n}`, status: status as never, scheduledAt: '2026-10-01T18:00:00Z', startedAt: null, finishedAt: null,
  score: home ? { home: my, away: opp } : { home: opp, away: my }, venue: null,
  homeTeam: { id: home ? T : 'x', name: home ? 'ME' : 'X', shortName: null, logoUrl: null },
  awayTeam: { id: home ? 'x' : T, name: home ? 'X' : 'ME', shortName: null, logoUrl: null },
  ...extra,
});

describe('teamResult', () => {
  it('victoria, empate y derrota desde el punto de vista del equipo', () => {
    expect(teamResult(T, m(true, 'finished', 3, 1))).toBe('W');
    expect(teamResult(T, m(false, 'finished', 2, 2))).toBe('D');
    expect(teamResult(T, m(false, 'finished', 1, 4))).toBe('L');
    expect(teamResult(T, m(true, 'scheduled', null, null))).toBeNull();
  });
  it('en eliminatorias decididas en penaltis manda el ganador explícito', () => {
    expect(teamResult(T, m(true, 'finished', 3, 3, { winnerTeamId: T, winType: 'penalties' }))).toBe('W');
    expect(teamResult(T, m(true, 'finished', 3, 3, { winnerTeamId: 'x', winType: 'penalties' }))).toBe('L');
  });
});

describe('filterTeamMatches', () => {
  const all = [m(true, 'finished', 3, 1), m(false, 'finished', 1, 4), m(true, 'finished', 2, 2), m(false, 'scheduled', null, null), m(true, 'live', 1, 0)];

  it('sin filtros devuelve todo', () => {
    expect(filterTeamMatches(all, T, {})).toHaveLength(5);
  });
  it('jugados incluye el directo, próximos solo lo pendiente', () => {
    expect(filterTeamMatches(all, T, { status: 'played' })).toHaveLength(4);
    expect(filterTeamMatches(all, T, { status: 'upcoming' }).map((x) => x.status)).toEqual(['scheduled']);
  });
  it('en casa y fuera', () => {
    expect(filterTeamMatches(all, T, { venue: 'home' })).toHaveLength(3);
    expect(filterTeamMatches(all, T, { venue: 'away' })).toHaveLength(2);
  });
  it('por resultado (solo terminados)', () => {
    expect(filterTeamMatches(all, T, { result: 'W' })).toHaveLength(1);
    expect(filterTeamMatches(all, T, { result: 'L', venue: 'away' })).toHaveLength(1);
  });
  it('recuentos para las etiquetas de los filtros', () => {
    expect(calendarCounts(all, T)).toEqual({ all: 5, played: 4, upcoming: 1, home: 3, away: 2, W: 1, D: 1, L: 1 });
  });
});

import { describe, it, expect } from 'vitest';
import { madridDateKey } from './match-time';
import type { Match, MatchSummary } from './api';
import { isUpcomingMatch, selectGradaMatches } from './grada';

/**
 * #263 "Mi grada": selección pura de próximos partidos y últimos resultados de
 * los equipos/ligas seguidos. Se apoya en la lista ya cargada por la home
 * (`/matches/current`), sin un fetch por equipo.
 */

function match(p: Partial<Match> & { id: string; status: Match['status']; scheduledAt: string | null }): Match {
  return {
    seasonId: 's1',
    roundId: null,
    competitionId: null,
    competitionName: null,
    startedAt: null,
    finishedAt: null,
    score: { home: null, away: null },
    venue: null,
    homeTeamId: 'h',
    awayTeamId: 'a',
    sourceRef: null,
    ...p,
  } as Match;
}

const TODAY = '2026-06-20';

describe('grada (origen web)', () => {
  it('usa startedAt si falta scheduledAt (regla web)', () => {
    const m = match({ id: 's', status: 'scheduled', scheduledAt: null, startedAt: '2026-06-22T18:00:00Z', competitionId: 'L1' });
    expect(isUpcomingMatch(m, TODAY)).toBe(true);
  });
});

describe('selectGradaMatches — próximos y últimos de los seguidos', () => {
  it('sin equipos ni ligas seguidos devuelve ambas listas vacías', () => {
    const matches = [match({ id: 'm1', status: 'scheduled', scheduledAt: '2026-06-21T18:00:00Z' })];
    const out = selectGradaMatches(matches, { teamIds: [], leagueIds: [], todayKey: TODAY });
    expect(out.upcoming).toEqual([]);
    expect(out.results).toEqual([]);
  });

  it('incluye partidos donde juega un equipo seguido (local o visitante)', () => {
    const matches = [
      match({ id: 'm1', status: 'scheduled', scheduledAt: '2026-06-21T18:00:00Z', homeTeamId: 'T1', awayTeamId: 'x' }),
      match({ id: 'm2', status: 'scheduled', scheduledAt: '2026-06-21T20:00:00Z', homeTeamId: 'x', awayTeamId: 'T1' }),
      match({ id: 'm3', status: 'scheduled', scheduledAt: '2026-06-21T22:00:00Z', homeTeamId: 'y', awayTeamId: 'z' }),
    ];
    const out = selectGradaMatches(matches, { teamIds: ['T1'], leagueIds: [], todayKey: TODAY });
    expect(out.upcoming.map((m) => m.id)).toEqual(['m1', 'm2']);
  });

  it('incluye partidos de una liga seguida por competitionId', () => {
    const matches = [
      match({ id: 'm1', status: 'scheduled', scheduledAt: '2026-06-21T18:00:00Z', competitionId: 'L1' }),
      match({ id: 'm2', status: 'scheduled', scheduledAt: '2026-06-21T20:00:00Z', competitionId: 'L2' }),
    ];
    const out = selectGradaMatches(matches, { teamIds: [], leagueIds: ['L1'], todayKey: TODAY });
    expect(out.upcoming.map((m) => m.id)).toEqual(['m1']);
  });

  it('separa próximos (ascendente) y resultados (descendente)', () => {
    const matches = [
      match({ id: 'r1', status: 'finished', scheduledAt: '2026-06-18T18:00:00Z', competitionId: 'L1' }),
      match({ id: 'r2', status: 'finished', scheduledAt: '2026-06-19T18:00:00Z', competitionId: 'L1' }),
      match({ id: 'u1', status: 'scheduled', scheduledAt: '2026-06-25T18:00:00Z', competitionId: 'L1' }),
      match({ id: 'u2', status: 'scheduled', scheduledAt: '2026-06-22T18:00:00Z', competitionId: 'L1' }),
    ];
    const out = selectGradaMatches(matches, { teamIds: [], leagueIds: ['L1'], todayKey: TODAY });
    expect(out.upcoming.map((m) => m.id)).toEqual(['u2', 'u1']);
    expect(out.results.map((m) => m.id)).toEqual(['r2', 'r1']);
  });

  it('no cuenta un partido en juego como próximo (vive en la banda/tira)', () => {
    const matches = [match({ id: 'live', status: 'live', scheduledAt: '2026-06-20T18:00:00Z', competitionId: 'L1' })];
    const out = selectGradaMatches(matches, { teamIds: [], leagueIds: ['L1'], todayKey: TODAY });
    expect(out.upcoming.map((m) => m.id)).toEqual([]);
  });

  it('excluye un partido scheduled de un día ya pasado (no es un próximo real)', () => {
    const matches = [
      match({ id: 'old', status: 'scheduled', scheduledAt: '2026-06-15T18:00:00Z', competitionId: 'L1' }),
      match({ id: 'today', status: 'scheduled', scheduledAt: '2026-06-20T21:00:00Z', competitionId: 'L1' }),
    ];
    const out = selectGradaMatches(matches, { teamIds: [], leagueIds: ['L1'], todayKey: TODAY });
    expect(out.upcoming.map((m) => m.id)).toEqual(['today']);
    expect(out.results).toEqual([]);
  });

  it('ignora partidos cancelados', () => {
    const matches = [match({ id: 'c', status: 'cancelled', scheduledAt: '2026-06-21T18:00:00Z', competitionId: 'L1' })];
    const out = selectGradaMatches(matches, { teamIds: [], leagueIds: ['L1'], todayKey: TODAY });
    expect(out.upcoming).toEqual([]);
    expect(out.results).toEqual([]);
  });

  it('respeta el límite por lista', () => {
    const matches = Array.from({ length: 6 }, (_, i) =>
      match({ id: `u${i}`, status: 'scheduled', scheduledAt: `2026-06-2${i + 1}T18:00:00Z`, competitionId: 'L1' }));
    const out = selectGradaMatches(matches, { teamIds: [], leagueIds: ['L1'], todayKey: TODAY, limit: 3 });
    expect(out.upcoming).toHaveLength(3);
  });
});

describe('grada (origen app, forma cruda MatchSummary)', () => {
  const makeMatch = (
    id: string,
    homeId: string,
    awayId: string,
    status: MatchSummary['status'],
    date: string,
    compId = 'c1',
  ): MatchSummary =>
    ({
      id,
      competitionId: compId,
      competitionName: 'OK Liga',
      status,
      scheduledAt: date,
      score: { home: 2, away: 1 },
      homeTeam: { id: homeId, name: 'Home Team', shortName: 'HT', logoUrl: null },
      awayTeam: { id: awayId, name: 'Away Team', shortName: 'AT', logoUrl: null },
    } as unknown as MatchSummary);

  it('formats madrid date key properly', () => {
    expect(madridDateKey('2026-10-22T21:00:00Z')).toBe('2026-10-22');
  });

  it('identifies upcoming matches correctly', () => {
    const scheduled = makeMatch('1', 't1', 't2', 'scheduled', '2026-10-23T18:00:00Z');
    const finished = makeMatch('2', 't1', 't2', 'finished', '2026-10-21T18:00:00Z');
    expect(isUpcomingMatch(scheduled, '2026-10-22')).toBe(true);
    expect(isUpcomingMatch(finished, '2026-10-22')).toBe(false);
  });

  it('selects and sorts upcoming and finished matches for followed teams', () => {
    const m1 = makeMatch('m1', 't1', 't2', 'finished', '2026-10-20T18:00:00Z');
    const m2 = makeMatch('m2', 't1', 't3', 'finished', '2026-10-21T18:00:00Z');
    const m3 = makeMatch('m3', 't4', 't1', 'scheduled', '2026-10-25T18:00:00Z');
    const m4 = makeMatch('m4', 't1', 't5', 'scheduled', '2026-10-24T18:00:00Z');
    const mOther = makeMatch('m5', 'x1', 'x2', 'scheduled', '2026-10-24T18:00:00Z');

    const selection = selectGradaMatches([m1, m2, m3, m4, mOther], {
      teamIds: ['t1'],
      leagueIds: [],
      todayKey: '2026-10-22',
    });

    expect(selection.upcoming.map((m) => m.id)).toEqual(['m4', 'm3']);
    expect(selection.results.map((m) => m.id)).toEqual(['m2', 'm1']);
  });
});

import { describe, it, expect } from 'vitest';
import type { Match } from '@/lib/api/client';
import { selectGradaMatches } from './grada';

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

  it('cuenta un partido en juego como próximo aunque su día sea hoy', () => {
    const matches = [match({ id: 'live', status: 'live', scheduledAt: '2026-06-20T18:00:00Z', competitionId: 'L1' })];
    const out = selectGradaMatches(matches, { teamIds: [], leagueIds: ['L1'], todayKey: TODAY });
    expect(out.upcoming.map((m) => m.id)).toEqual(['live']);
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

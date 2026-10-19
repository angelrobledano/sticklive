import { describe, it, expect } from 'vitest';
import type { SeasonOverview } from '@/lib/api/types';
import { buildCompetitionSummary, buildMatchPreview } from './content-summary';

function match(overrides: Partial<SeasonOverview['matches'][number]> = {}): SeasonOverview['matches'][number] {
  return {
    id: 'm1', status: 'finished', scheduledAt: '2026-10-01T18:00:00Z', startedAt: null,
    finishedAt: '2026-10-01T19:30:00Z', score: { home: 2, away: 1 },
    homeTeam: { id: 'h', name: 'Local', shortName: null, logoUrl: null },
    awayTeam: { id: 'a', name: 'Visitante', shortName: null, logoUrl: null },
    roundId: null, roundNumber: 1, roundName: 'Jornada 1', roundType: 'regular',
    ...overrides,
  } as SeasonOverview['matches'][number];
}

const overview = {
  season: { id: 's1', name: '2026/27', competitionId: 'c1', competitionName: 'Liga' },
  standings: [
    { teamId: 'h', teamName: 'Local', position: 1, played: 5, points: 13, form: ['W', 'W', 'D'] },
    { teamId: 'a', teamName: 'Visitante', position: 3, played: 5, points: 8, form: ['L', 'W', 'L'] },
  ],
  rounds: [],
  matches: [
    match({ id: 'prev', homeTeam: { id: 'a', name: 'Visitante', shortName: null, logoUrl: null }, awayTeam: { id: 'h', name: 'Local', shortName: null, logoUrl: null }, score: { home: 0, away: 2 } }),
    match({ id: 'current', status: 'scheduled', scheduledAt: '2026-10-20T18:00:00Z', score: { home: null, away: null } }),
    match({ id: 'other', homeTeam: { id: 'x', name: 'Otro', shortName: null, logoUrl: null }, awayTeam: { id: 'y', name: 'Rival', shortName: null, logoUrl: null } }),
  ],
} as unknown as SeasonOverview;

describe('buildMatchPreview', () => {
  it('devuelve posición, forma y H2H del mismo emparejamiento', () => {
    const preview = buildMatchPreview(overview, {
      matchId: 'current', homeTeamId: 'h', awayTeamId: 'a', homeName: 'Local', awayName: 'Visitante',
    });
    expect(preview.home.position).toBe(1);
    expect(preview.home.form).toEqual(['W', 'W', 'D']);
    expect(preview.headToHead).toHaveLength(1);
    expect(preview.headToHead[0]?.id).toBe('prev');
  });
});

describe('buildCompetitionSummary', () => {
  it('elige líder, próximo partido y goleador solo si hay datos', () => {
    const summary = buildCompetitionSummary(overview, {
      topScorers: [{ playerId: 'p1', playerName: 'Ana', photoUrl: null, teamId: 'h', teamShort: null, teamName: 'Local', value: 9, extra: 0 }],
      topAssists: [], topCards: [],
    }, new Date('2026-10-19T00:00:00Z'));
    expect(summary.leader?.teamName).toBe('Local');
    expect(summary.nextMatch?.id).toBe('current');
    expect(summary.topScorer?.playerName).toBe('Ana');
  });

  it('no inventa un líder si nadie ha jugado', () => {
    const empty = { ...overview, standings: overview.standings.map((s) => ({ ...s, played: 0 })) } as SeasonOverview;
    expect(buildCompetitionSummary(empty, null).leader).toBeNull();
  });
});

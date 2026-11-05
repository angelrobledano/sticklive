import { describe, expect, it } from 'vitest';
import {
  advancedFrom,
  buildSeries,
  gameWinnerId,
  groupByPhase,
  placementMatches,
  seriesWinnerId,
} from './playoff';
import type { SeasonMatch } from './api/types';

function createMatch(partial: Partial<SeasonMatch>): SeasonMatch {
  return {
    id: 'm1',
    status: 'finished',
    competitionTimezone: 'Europe/Madrid',
    scheduledAt: '2026-05-15T18:00:00Z',
    startedAt: null,
    finishedAt: null,
    score: { home: 3, away: 2 },
    winnerTeamId: null,
    winType: null,
    penalties: null,
    venueName: null,
    roundId: 'r1',
    groupName: null,
    phaseId: 'p1',
    stage: 'quarters',
    seriesGame: 1,
    roundNumber: 1,
    roundName: 'Cuartos 1',
    roundType: 'playoff',
    homeTeam: { id: 'team-a', name: 'Team A', shortName: 'TMA', logoUrl: null },
    awayTeam: { id: 'team-b', name: 'Team B', shortName: 'TMB', logoUrl: null },
    ...partial,
  };
}

describe('playoff helpers', () => {
  describe('gameWinnerId', () => {
    it('returns explicit winnerTeamId if present', () => {
      const m = createMatch({ winnerTeamId: 'team-b', score: { home: 4, away: 4 } });
      expect(gameWinnerId(m)).toBe('team-b');
    });

    it('returns home team if home score is higher', () => {
      const m = createMatch({ score: { home: 5, away: 3 } });
      expect(gameWinnerId(m)).toBe('team-a');
    });

    it('returns away team if away score is higher', () => {
      const m = createMatch({ score: { home: 1, away: 4 } });
      expect(gameWinnerId(m)).toBe('team-b');
    });

    it('resolves penalty shootout when scores are tied', () => {
      const m = createMatch({
        score: { home: 2, away: 2 },
        penalties: { home: 3, away: 1 },
      });
      expect(gameWinnerId(m)).toBe('team-a');
    });

    it('returns null on unresolved tie without penalties', () => {
      const m = createMatch({ score: { home: 2, away: 2 }, penalties: null });
      expect(gameWinnerId(m)).toBeNull();
    });

    it('returns null if scores are null', () => {
      const m = createMatch({ score: { home: null, away: null } });
      expect(gameWinnerId(m)).toBeNull();
    });
  });

  describe('buildSeries and seriesWinnerId', () => {
    it('groups games between two teams and tallies wins', () => {
      const g1 = createMatch({
        id: 'g1',
        scheduledAt: '2026-05-10T18:00:00Z',
        score: { home: 4, away: 1 },
        homeTeam: { id: 'team-a', name: 'Team A', shortName: 'A', logoUrl: null },
        awayTeam: { id: 'team-b', name: 'Team B', shortName: 'B', logoUrl: null },
      });
      const g2 = createMatch({
        id: 'g2',
        scheduledAt: '2026-05-12T18:00:00Z',
        score: { home: 3, away: 2 },
        homeTeam: { id: 'team-b', name: 'Team B', shortName: 'B', logoUrl: null },
        awayTeam: { id: 'team-a', name: 'Team A', shortName: 'A', logoUrl: null },
      });
      const g3 = createMatch({
        id: 'g3',
        scheduledAt: '2026-05-15T18:00:00Z',
        score: { home: 5, away: 2 },
        homeTeam: { id: 'team-a', name: 'Team A', shortName: 'A', logoUrl: null },
        awayTeam: { id: 'team-b', name: 'Team B', shortName: 'B', logoUrl: null },
      });

      const series = buildSeries([g1, g2, g3]);
      expect(series).toHaveLength(1);
      expect(series[0].winsA).toBe(2); // Team A won g1 and g3
      expect(series[0].winsB).toBe(1); // Team B won g2
      expect(seriesWinnerId(series[0])).toBe('team-a');
    });

    it('returns null for seriesWinnerId if a match is live or scheduled', () => {
      const g1 = createMatch({ id: 'g1', status: 'finished', score: { home: 4, away: 1 } });
      const g2 = createMatch({ id: 'g2', status: 'scheduled', score: { home: null, away: null } });
      const series = buildSeries([g1, g2]);
      expect(seriesWinnerId(series[0])).toBeNull();
    });
  });

  describe('groupByPhase and placementMatches', () => {
    it('buckets matches into Cuartos, Semis, Final and identifies placement', () => {
      const qf = createMatch({ id: 'q1', stage: 'quarters' });
      const sf = createMatch({ id: 's1', stage: 'semis' });
      const f = createMatch({ id: 'f1', stage: 'final' });
      const pl = createMatch({ id: 'p1', stage: 'placement' });

      const grouped = groupByPhase([qf, sf, f, pl]);
      expect(grouped.Cuartos).toHaveLength(1);
      expect(grouped.Semis).toHaveLength(1);
      expect(grouped.Final).toHaveLength(1);

      const placements = placementMatches([qf, sf, f, pl]);
      expect(placements).toHaveLength(1);
      expect(placements[0].id).toBe('p1');
    });

    it('infers Semis and Final for a 3-match Final Four without explicit stages', () => {
      const semi1 = createMatch({
        id: 's1',
        stage: null,
        roundNumber: 4,
        roundName: 'FINAL',
        scheduledAt: '2025-09-20T14:15:00Z',
        homeTeam: { id: 'team-a', name: 'Team A', shortName: 'A', logoUrl: null },
        awayTeam: { id: 'team-b', name: 'Team B', shortName: 'B', logoUrl: null },
      });
      const semi2 = createMatch({
        id: 's2',
        stage: null,
        roundNumber: 4,
        roundName: 'FINAL',
        scheduledAt: '2025-09-20T16:45:00Z',
        homeTeam: { id: 'team-c', name: 'Team C', shortName: 'C', logoUrl: null },
        awayTeam: { id: 'team-d', name: 'Team D', shortName: 'D', logoUrl: null },
      });
      const finalMatch = createMatch({
        id: 'f1',
        stage: null,
        roundNumber: 4,
        roundName: 'FINAL',
        scheduledAt: '2025-09-21T10:15:00Z',
        homeTeam: { id: 'team-b', name: 'Team B', shortName: 'B', logoUrl: null },
        awayTeam: { id: 'team-c', name: 'Team C', shortName: 'C', logoUrl: null },
      });

      const grouped = groupByPhase([semi1, semi2, finalMatch]);
      expect(grouped.Cuartos).toHaveLength(0);
      expect(grouped.Semis).toHaveLength(2);
      expect(grouped.Semis.map((m) => m.id)).toEqual(['s1', 's2']);
      expect(grouped.Final).toHaveLength(1);
      expect(grouped.Final[0]!.id).toBe('f1');
    });
  });

  describe('advancedFrom', () => {
    it('identifies teams present in next phase', () => {
      const sf = buildSeries([
        createMatch({
          homeTeam: { id: 'team-a', name: 'A', shortName: 'A', logoUrl: null },
          awayTeam: { id: 'team-c', name: 'C', shortName: 'C', logoUrl: null },
        }),
      ]);
      const advanced = advancedFrom(sf);
      expect(advanced.has('team-a')).toBe(true);
      expect(advanced.has('team-c')).toBe(true);
      expect(advanced.has('team-b')).toBe(false);
    });
  });
});

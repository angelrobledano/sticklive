import { describe, expect, it } from 'vitest';
import { buildPlayerFacts } from './player-facts';
import type { PlayerDetail } from './api/types';

describe('buildPlayerFacts', () => {
  const basePlayer: PlayerDetail = {
    player: {
      id: 'p1',
      firstName: 'Pau',
      lastName: 'Bargalló',
      nationality: 'ES',
      isGoalkeeper: false,
      photoUrl: null,
      birthDate: '1994-01-11',
      sourceRef: null,
    },
    currentTeam: {
      id: 't1',
      name: 'Barça',
      shortName: 'FCB',
      logoUrl: null,
      jerseyNumber: 8,
      seasonId: 's1',
    },
    seasonTotals: {
      pj: 10,
      goals: 15,
      assists: 8,
      blueCards: 2,
      redCards: 0,
      penaltiesTotal: 5,
      penaltiesScored: 4,
    },
    career: { seasons: [], totals: { pj: 10, goals: 15, blueCards: 2, redCards: 0, penaltiesTotal: 5, penaltiesScored: 4 } },
    statsByCompetition: [],
  };

  it('returns empty facts when player has played fewer than 5 matches', () => {
    const data = {
      ...basePlayer,
      seasonTotals: { ...basePlayer.seasonTotals, pj: 4 },
    };
    expect(buildPlayerFacts(data)).toEqual([]);
  });

  it('calculates facts correctly when thresholds are met', () => {
    const facts = buildPlayerFacts(basePlayer);
    expect(facts).toEqual([
      { kind: 'goals_per_match', value: 1.5, extra: 15 },
      { kind: 'assists_per_match', value: 0.8, extra: 8 },
      { kind: 'participation', value: 2.3, extra: 23 },
      { kind: 'penalty_pct', value: 80, extra: 5 },
      { kind: 'discipline', value: 2, extra: 0 },
    ]);
  });
});

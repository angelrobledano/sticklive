import { describe, it, expect } from 'vitest';
import type { PlayerDetail } from '@/lib/api/types';
import { buildPlayerFacts } from './player-facts';

function detail(overrides: Partial<PlayerDetail['seasonTotals']> = {}): PlayerDetail {
  return {
    player: { id: 'p1', firstName: 'A', lastName: 'B', birthDate: null, nationality: null, isGoalkeeper: false, sourceRef: null },
    currentTeam: null,
    seasonTotals: { pj: 10, goals: 6, assists: 4, blueCards: 2, redCards: 0, penaltiesTotal: 4, penaltiesScored: 3, ...overrides },
    statsByCompetition: [],
    career: { seasons: [], totals: { pj: 0, goals: 0, blueCards: 0, redCards: 0, penaltiesTotal: 0, penaltiesScored: 0 } },
  };
}

describe('buildPlayerFacts', () => {
  it('calcula goles/asistencias por partido, participación y penaltis', () => {
    const facts = buildPlayerFacts(detail());
    expect(facts.find((f) => f.kind === 'goals_per_match')).toMatchObject({ value: 0.6, extra: 6 });
    expect(facts.find((f) => f.kind === 'assists_per_match')).toMatchObject({ value: 0.4, extra: 4 });
    expect(facts.find((f) => f.kind === 'participation')).toMatchObject({ value: 1, extra: 10 });
    expect(facts.find((f) => f.kind === 'penalty_pct')).toMatchObject({ value: 75, extra: 4 });
  });

  it('no publica nada con muestra pequeña', () => {
    expect(buildPlayerFacts(detail({ pj: 4 }))).toEqual([]);
  });
});

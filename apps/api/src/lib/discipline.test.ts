import { describe, it, expect } from 'vitest';
import { buildSeasonDiscipline, type DisciplineCardRow } from './discipline.js';

function card(overrides: Partial<DisciplineCardRow> = {}): DisciplineCardRow {
  return {
    matchId: 'm1', teamId: 't1', playerId: 'p1', firstName: 'Ana', lastName: 'Ferrer',
    minute: 12, roundNumber: 5, roundName: 'Jornada 5', roundType: 'regular', ...overrides,
  };
}

describe('buildSeasonDiscipline', () => {
  it('solo devuelve las rojas de la última jornada regular', () => {
    const d = buildSeasonDiscipline([
      card({ matchId: 'old', roundNumber: 4 }),
      card({ matchId: 'last', roundNumber: 5, playerId: 'p2', firstName: 'Luis', lastName: 'Vidal' }),
      card({ matchId: 'cup', roundNumber: 9, roundType: 'cup' }),
    ], { number: 5, name: 'Jornada 5' });
    expect(d.roundNumber).toBe(5);
    expect(d.reds).toHaveLength(1);
    expect(d.reds[0]).toMatchObject({ matchId: 'last', playerId: 'p2', firstName: 'Luis' });
  });

  it('sin jornada regular no publica nada', () => {
    expect(buildSeasonDiscipline([card()], { number: null, name: null })).toEqual({
      roundNumber: null, roundName: null, reds: [],
    });
  });
});

import { describe, it, expect } from 'vitest';
import { fppGoalsByPlayer } from './fpp-ficha.parser.js';

describe('goles FPP por jugador', () => {
  it('cuenta solo los goles con jugador', () => {
    const m = fppGoalsByPlayer([
      { eventType: 'goal', playerSourceRef: 'fpp_player_1' },
      { eventType: 'goal', playerSourceRef: 'fpp_player_1' },
      { eventType: 'blue_card', playerSourceRef: 'fpp_player_1' },
      { eventType: 'goal', playerSourceRef: null },
      { eventType: 'goal', playerSourceRef: 'fpp_player_2' },
    ]);
    expect([...m]).toEqual([['fpp_player_1', 2], ['fpp_player_2', 1]]);
  });
});

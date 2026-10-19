import { describe, it, expect } from 'vitest';
import { buildPlayerPercentiles, type PeerPlayer } from './player-percentiles.js';

function peer(id: string, pj: number, goals: number, assists = 0, penaltiesTotal = 0, penaltiesScored = 0): PeerPlayer {
  return { playerId: id, pj, goals, assists, penaltiesTotal, penaltiesScored };
}

describe('buildPlayerPercentiles', () => {
  it('calcula puesto y percentil solo con muestra suficiente', () => {
    const players = [peer('p1', 10, 20), peer('p2', 10, 10), peer('p3', 10, 5), peer('p4', 4, 50)];
    const metrics = buildPlayerPercentiles('p2', players);
    const goals = metrics.find((m) => m.kind === 'goals_per_match');
    expect(goals).toMatchObject({ value: 1, rank: 2, percentile: 67, peers: 3 });
  });

  it('no publica penaltis con menos de 3 lanzamientos', () => {
    const players = [
      peer('p1', 10, 1, 0, 3, 3),
      peer('p2', 10, 1, 0, 2, 2),
      peer('p3', 10, 1, 0, 4, 1),
      peer('p4', 10, 1, 0, 3, 0),
    ];
    expect(buildPlayerPercentiles('p2', players).some((m) => m.kind === 'penalty_pct')).toBe(false);
    expect(buildPlayerPercentiles('p1', players).find((m) => m.kind === 'penalty_pct')).toMatchObject({
      value: 100, rank: 1, peers: 3, percentile: 100,
    });
  });

  it('sin 5 partidos no hay métricas', () => {
    expect(buildPlayerPercentiles('p1', [peer('p1', 4, 10), peer('p2', 4, 2)])).toEqual([]);
  });
});

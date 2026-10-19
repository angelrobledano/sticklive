import { describe, it, expect } from 'vitest';
import type { MatchEvent } from '@/lib/api/types';
import { buildMatchChronicle } from './match-chronicle';

function goal(overrides: Partial<MatchEvent> = {}): MatchEvent {
  return {
    id: 'e1', eventType: 'goal', minute: 10, period: 1, teamId: 'h', isHomeTeam: true,
    detail: null, player: null, ...overrides,
  } as MatchEvent;
}

describe('buildMatchChronicle', () => {
  it('detecta remontada con goles de primera y segunda parte', () => {
    const facts = buildMatchChronicle({
      status: 'finished', score: { home: 2, away: 1 }, homeTeamId: 'h', awayTeamId: 'a',
      events: [
        goal({ id: 'a1', teamId: 'a', isHomeTeam: false, minute: 5 }),
        goal({ id: 'h1', minute: 30, period: 2 }),
        goal({ id: 'h2', minute: 48, period: 2 }),
      ],
    });
    expect(facts.some((f) => f.kind === 'comeback' && f.teamId === 'h')).toBe(true);
  });

  it('detecta hat-trick y gol en los últimos cinco minutos', () => {
    const player = { id: 'p1', firstName: 'Ana', lastName: 'Ferrer' };
    const facts = buildMatchChronicle({
      status: 'finished', score: { home: 3, away: 0 }, homeTeamId: 'h', awayTeamId: 'a',
      events: [
        goal({ id: '1', minute: 10, player }),
        goal({ id: '2', minute: 20, player }),
        goal({ id: '3', minute: 47, player }),
      ],
    });
    expect(facts).toContainEqual(expect.objectContaining({ kind: 'hat_trick', playerId: 'p1', goals: 3 }));
    expect(facts).toContainEqual(expect.objectContaining({ kind: 'late_goal', teamId: 'h' }));
    expect(facts).toContainEqual(expect.objectContaining({ kind: 'clean_sheet', teamId: 'h' }));
  });

  it('no inventa nada si el partido no ha terminado o no hay acta', () => {
    expect(buildMatchChronicle({
      status: 'scheduled', score: { home: null, away: null }, homeTeamId: 'h', awayTeamId: 'a', events: [],
    })).toEqual([]);
  });
});

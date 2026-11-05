import { describe, it, expect } from 'vitest';
import type { MatchEvent } from './api';
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

  it('detecta hat-trick y gol en los Ãºltimos cinco minutos', () => {
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

describe('crónica ampliada con estadísticas del acta', () => {
  const stats = {
    homeFouls: 13, awayFouls: 7,
    homeTimeouts: 3, awayTimeouts: 4,
    homeDirectFouls: { total: 0, scored: 0 },
    awayDirectFouls: { total: 1, scored: 1 },
    homePenalties: { total: 0, scored: 0 },
    awayPenalties: { total: 0, scored: 0 },
  } as never;
  const player = (id: string, firstName: string, lastName: string) => ({ id, firstName, lastName });
  const event = (id: string, eventType: MatchEvent['eventType'], minute: number, period: number, isHomeTeam: boolean, extra: Partial<MatchEvent> = {}) => ({
    id, eventType, minute, period, teamId: isHomeTeam ? 'arg' : 'fra', isHomeTeam, detail: null, player: null, ...extra,
  }) as MatchEvent;

  it('extrae goles por parte, remontada, igualada, racha, falta directa, faltas y tanda', () => {
    const facts = buildMatchChronicle({
      status: 'finished', score: { home: 2, away: 2 }, homeTeamId: 'arg', awayTeamId: 'fra',
      winType: 'penalties', stats,
      penaltyShootout: {
        home: Array.from({ length: 7 }, (_, i) => ({ player: 'ARG', scored: i === 1 })),
        away: Array.from({ length: 7 }, (_, i) => ({ player: 'FRA', scored: i === 3 || i === 6 })),
      },
      events: [
        event('g1', 'goal', 20, 1, true, { player: player('p1', 'EZEQUIEL', 'MENA TOMAS') }),
        event('g2', 'goal', 11, 2, false, { player: player('p2', 'BRUNO', 'DI BENEDETTO') }),
        event('df', 'direct_foul', 14, 2, false, { detail: 'marcada', player: player('p3', 'CARLO', 'DI BENEDETTO') }),
        event('g3', 'goal', 14, 2, false, { player: player('p3', 'CARLO', 'DI BENEDETTO') }),
        event('g4', 'goal', 22, 2, true, { player: player('p4', 'LUCAS', 'MARTINEZ') }),
      ],
    });
    const kinds = facts.map((f) => f.kind);
    expect(kinds).toEqual(expect.arrayContaining([
      'shootout', 'turnaround', 'period_goals', 'opening_goal', 'late_equalizer',
      'goal_flurry', 'direct_foul_goal', 'fouls', 'timeouts',
    ]));
    expect(facts.find((f) => f.kind === 'late_equalizer')).toMatchObject({ teamId: 'arg', playerId: 'p4', minute: 47 });
    expect(facts.find((f) => f.kind === 'goal_flurry')).toMatchObject({ teamId: 'fra', values: { n: 2, from: 36, to: 39 } });
    expect(facts.find((f) => f.kind === 'shootout')).toMatchObject({ teamId: 'fra', values: { home: 1, away: 2, rounds: 7, scored: 3, attempts: 14 } });
  });
});

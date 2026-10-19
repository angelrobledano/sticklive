import { describe, it, expect } from 'vitest';
import { computeSeasonInsights, type InsightInput, type InsightMatch, type InsightGoal } from './insights.js';

let seq = 0;
function m(home: string, away: string, hs: number, as: number, opts: Partial<InsightMatch> = {}): InsightMatch {
  seq++;
  return {
    id: `m${seq}`, date: `2026-01-${String(seq).padStart(2, '0')}T18:00:00Z`,
    homeTeamId: home, awayTeamId: away, homeScore: hs, awayScore: as, league: true, fullEvents: true, ...opts,
  };
}

const base = (matches: InsightMatch[], extra: Partial<InsightInput> = {}): InsightInput => ({
  teams: ['a', 'b', 'c', 'd'].map((id) => ({ id, name: id })), matches, goals: [], setPieces: [], scorers: [], ...extra,
});
const kinds = (i: InsightInput) => computeSeasonInsights(i).map((x) => x.kind);
const find = (i: InsightInput, kind: string) => computeSeasonInsights(i).find((x) => x.kind === kind);

describe('computeSeasonInsights', () => {
  it('sin partidos no inventa nada', () => {
    expect(computeSeasonInsights(base([]))).toEqual([]);
  });

  it('único invicto con 4 partidos o más; con dos invictos, nada', () => {
    const ms = [m('a', 'b', 3, 1), m('c', 'a', 2, 2), m('a', 'd', 4, 0), m('b', 'a', 1, 5)];
    expect(find(base(ms), 'only_unbeaten')).toMatchObject({ teamIds: ['a'], values: { played: 4, won: 3, drawn: 1 } });
    expect(kinds(base(ms.slice(0, 3)))).not.toContain('only_unbeaten');
  });

  it('racha de victorias en curso de 3 o más', () => {
    const ms = [m('a', 'b', 0, 1), m('a', 'c', 2, 1), m('d', 'a', 0, 3), m('a', 'b', 5, 2)];
    expect(find(base(ms), 'win_streak')).toMatchObject({ teamIds: ['a'], values: { n: 3 } });
  });

  it('temporada terminada: sin rachas "en curso"', () => {
    const ms = [m('a', 'b', 0, 1), m('a', 'c', 2, 1), m('d', 'a', 0, 3), m('a', 'b', 5, 2)];
    expect(kinds({ ...base(ms), seasonFinished: true })).not.toContain('win_streak');
  });

  it('una racha de 2 no sale', () => {
    expect(kinds(base([m('a', 'b', 2, 1), m('a', 'c', 2, 1)]))).not.toContain('win_streak');
  });

  it('mejor ataque y mejor defensa por partido, solo con 3+ equipos regulares', () => {
    const ms = [
      m('a', 'b', 6, 1), m('c', 'd', 2, 2), m('a', 'c', 5, 0), m('b', 'd', 1, 1),
      m('a', 'd', 4, 3), m('b', 'c', 2, 0),
    ];
    expect(find(base(ms), 'best_attack')).toMatchObject({ teamIds: ['a'], values: { goals: 15, played: 3, perMatch: 5 } });
    expect(find(base(ms), 'best_defense')).toMatchObject({ teamIds: ['a'], values: { conceded: 4, played: 3 } });
  });

  it('el empate en lo más alto no da "el que más"', () => {
    const ms = [m('a', 'b', 4, 0), m('c', 'd', 4, 0), m('a', 'c', 0, 0), m('b', 'd', 0, 0), m('a', 'd', 0, 0), m('b', 'c', 0, 0)];
    expect(kinds(base(ms))).not.toContain('best_attack');
  });

  it('goleada y partido con más goles, con umbral', () => {
    const ms = [m('a', 'b', 9, 1), m('c', 'd', 7, 6), m('a', 'c', 2, 1)];
    expect(find(base(ms), 'biggest_win')).toMatchObject({ matchId: ms[0]!.id, values: { home: 9, away: 1 } });
    expect(find(base(ms), 'highest_scoring')).toMatchObject({ matchId: ms[1]!.id, values: { home: 7, away: 6 } });
  });

  it('dependencia del goleador: % de los goles de su equipo', () => {
    const ms = [m('a', 'b', 6, 1), m('a', 'c', 6, 0)];
    const i = base(ms, { scorers: [{ playerId: 'p1', teamId: 'a', goals: 6 }, { playerId: 'p2', teamId: 'a', goals: 3 }] });
    expect(find(i, 'scorer_share')).toMatchObject({ playerIds: ['p1'], teamIds: ['a'], values: { goals: 6, teamGoals: 12, pct: 50 } });
  });

  describe('con actas', () => {
    function conGoles(fullEvents: boolean) {
      const ms = Array.from({ length: 10 }, () => m('a', 'b', 4, 1, { fullEvents }));
      const goals: InsightGoal[] = ms.flatMap((x) => [
        { matchId: x.id, teamId: 'a', period: 1, minute: 3 },
        { matchId: x.id, teamId: 'a', period: 2, minute: 10 },
        { matchId: x.id, teamId: 'a', period: 2, minute: 22 },
        { matchId: x.id, teamId: 'a', period: 2, minute: 24 },
        { matchId: x.id, teamId: 'b', period: 2, minute: 5 },
      ]);
      return base(ms, { goals });
    }

    it('goles por parte de la liga y del equipo', () => {
      expect(find(conGoles(true), 'second_half_goals')).toMatchObject({ values: { pct: 80, goals: 50 } });
      expect(find(conGoles(true), 'team_second_half')).toMatchObject({ teamIds: ['a'], values: { pct: 75, goals: 40 } });
    });

    it('goles en los últimos 5 minutos (minuto 21-25 de la 2.ª parte)', () => {
      expect(find(conGoles(true), 'late_goals')).toMatchObject({ teamIds: ['a'], values: { goals: 20, teamGoals: 40 } });
    });

    it('con menos del 80 % de actas completas no hay insights de eventos', () => {
      const k = kinds(conGoles(false));
      expect(k).not.toContain('second_half_goals');
      expect(k).not.toContain('late_goals');
    });

    it('balón parado: % de la liga con 15+ lanzamientos y sequía de penaltis', () => {
      const ms = Array.from({ length: 8 }, () => m('a', 'b', 2, 1));
      const setPieces = ms.flatMap((x, i) => [
        { matchId: x.id, teamId: 'a', kind: 'penalty' as const, scored: false },
        { matchId: x.id, teamId: 'b', kind: 'penalty' as const, scored: i % 2 === 0 },
      ]);
      const i = base(ms, { setPieces });
      expect(find(i, 'penalty_pct')).toMatchObject({ values: { pct: 25, scored: 4, total: 16 } });
      expect(find(i, 'penalty_drought')).toMatchObject({ teamIds: ['a'], values: { total: 8 } });
    });

    it('quien marca primero gana: con 20+ partidos', () => {
      const ms = Array.from({ length: 20 }, (_, i) => m('a', 'b', i < 15 ? 2 : 1, i < 15 ? 1 : 3));
      const goals: InsightGoal[] = ms.map((x) => ({ matchId: x.id, teamId: 'a', period: 1, minute: 2 }));
      expect(find(base(ms, { goals }), 'first_goal_wins')).toMatchObject({ values: { pct: 75, matches: 20 } });
    });
  });

  it('ids estables y ordenado por prioridad', () => {
    const ms = [m('a', 'b', 3, 1), m('c', 'a', 2, 2), m('a', 'd', 4, 0), m('b', 'a', 1, 5)];
    const r = computeSeasonInsights(base(ms));
    expect(r.find((x) => x.kind === 'only_unbeaten')?.id).toBe('only_unbeaten:a');
    expect(r.map((x) => x.priority)).toEqual([...r.map((x) => x.priority)].sort((x, y) => y - x));
  });
});

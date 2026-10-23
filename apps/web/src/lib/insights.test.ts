import { describe, it, expect } from 'vitest';
import type { Insight, SeasonInsights } from '@/lib/api/types';
import { renderInsight, pickDailyInsight, isRenderable } from './insights';

const ins = (id: string, priority: number, extra: Partial<Insight> = {}): Insight => ({
  id, kind: 'win_streak', priority, teamIds: [], playerIds: [], matchId: null, values: {}, ...extra,
});

const data: SeasonInsights = {
  insights: [],
  teams: { t1: { name: "CLUB D'ESPORTS VENDRELL", shortName: 'CEV' }, t2: { name: 'CP ALCORCÓN', shortName: null } },
  players: { p1: { firstName: 'JUAN GABRIEL', lastName: 'FERNANDEZ DELGADO' } },
  matches: { m1: { homeTeamId: 't1', awayTeamId: 't2', date: null } },
};

describe('renderInsight', () => {
  it('enlaza el equipo y formatea la cifra en el idioma', () => {
    const parts = renderInsight(ins('x', 50, { kind: 'best_attack', teamIds: ['t1'], values: { goals: 78, played: 22, perMatch: 3.5 } }), data, 'es');
    expect(parts[0]).toEqual({ href: '/teams/t1', text: "Club D'esports Vendrell" });
    expect(parts[1]).toContain('78 goles en 22 partidos (3,5 por partido)');
  });

  it('jugador con nombre de presentación y su equipo', () => {
    const parts = renderInsight(ins('x', 50, {
      kind: 'scorer_share', teamIds: ['t1'], playerIds: ['p1'], values: { goals: 12, teamGoals: 30, pct: 40 },
    }), data, 'es');
    expect(parts[0]).toEqual({ href: '/players/p1', text: 'Juan Gabriel Fernandez' });
    expect(parts[2]).toEqual({ href: '/teams/t1', text: "Club D'esports Vendrell" });
  });

  it('partido enlazado con su marcador', () => {
    const parts = renderInsight(ins('x', 40, { kind: 'biggest_win', matchId: 'm1', values: { home: 10, away: 1 } }), data, 'en');
    expect(parts[1]).toEqual({ href: '/matches/m1', text: "Club D'esports Vendrell 10-1 CP Alcorcón" });
  });

  it('temporada terminada: en pasado', () => {
    const i = ins('x', 50, { kind: 'only_unbeaten', teamIds: ['t1'], values: { won: 10, drawn: 2, played: 12 } });
    expect(renderInsight(i, data, 'es', 'past')[1]).toBe(' fue el único invicto: 10 victorias y 2 empates en 12 partidos.');
    expect(renderInsight(i, data, 'es')[1]).toBe(' es el único invicto: 10 victorias y 2 empates en 12 partidos.');
    expect(renderInsight(ins('y', 50, { kind: 'win_streak', teamIds: ['t1'], values: { n: 5 } }), data, 'en', 'past')[1])
      .toBe(' finished the season with 5 wins in a row.');
  });

  it('sin variante en pasado (récord de un partido) usa el presente', () => {
    const parts = renderInsight(ins('x', 40, { kind: 'biggest_win', matchId: 'm1', values: { home: 10, away: 1 } }), data, 'es', 'past');
    expect(parts[0]).toBe('La mayor goleada de la temporada: ');
  });

  it('catalán con sus propias frases', () => {
    expect(renderInsight(ins('x', 20, { kind: 'home_win_pct', values: { pct: 47 } }), data, 'ca')[0]).toContain("L'equip local guanya el 47 %");
    expect(renderInsight(ins('x', 20, { kind: 'home_win_pct', values: { pct: 47 } }), data, 'ca', 'past')[0]).toContain('va guanyar');
  });

  it('idioma desconocido: inglés', () => {
    expect(renderInsight(ins('x', 20, { kind: 'home_win_pct', values: { pct: 47 } }), data, 'de')[0]).toContain('47%');
  });
});

describe('isRenderable', () => {
  it('no pinta un insight que cita una entidad sin nombre', () => {
    expect(isRenderable(ins('x', 1, { teamIds: ['t9'] }), data)).toBe(false);
    expect(isRenderable(ins('x', 1, { teamIds: ['t1'], matchId: 'm1' }), data)).toBe(true);
  });
});

describe('pickDailyInsight', () => {
  const list = [ins('a', 90), ins('b', 80), ins('c', 70), ins('d', 60), ins('e', 50), ins('f', 10)];

  it('el mismo día devuelve siempre el mismo', () => {
    expect(pickDailyInsight(list, 's1', '2026-10-19')).toEqual(pickDailyInsight([...list].reverse(), 's1', '2026-10-19'));
  });

  it('solo elige entre los más interesantes', () => {
    const days = Array.from({ length: 40 }, (_, i) => `2026-11-${String(i % 30 + 1).padStart(2, '0')}`);
    const picked = new Set(days.map((d) => pickDailyInsight(list, 's1', d)!.id));
    expect(picked.has('f')).toBe(false);
    expect(picked.size).toBeGreaterThan(1);
  });

  it('sin insights, nada', () => {
    expect(pickDailyInsight([], 's1', '2026-10-19')).toBeNull();
  });
});

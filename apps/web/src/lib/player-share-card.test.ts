import { describe, it, expect } from 'vitest';
import { playerShareCard } from './player-share-card';
import type { PlayerDetail, PlayerInsights } from './api/types';

const detail = (over: Partial<PlayerDetail> = {}): PlayerDetail => ({
  player: {
    id: 'p1', firstName: 'FERRAN', lastName: 'FONT SANCHEZ', birthDate: '2001-03-04', nationality: 'ES',
    isGoalkeeper: false, sourceRef: 'fep_player_1', photoUrl: 'https://x/1.jpg',
  },
  currentTeam: { id: 't1', name: 'FC BARCELONA', shortName: 'BARÇA', logoUrl: null, jerseyNumber: 9, seasonId: 's1' },
  seasonTotals: { pj: 10, goals: 14, assists: 6, blueCards: 2, redCards: 0, penaltiesTotal: 5, penaltiesScored: 4 },
  statsByCompetition: [],
  career: { seasons: [], totals: { pj: 0, goals: 0, blueCards: 0, redCards: 0, penaltiesTotal: 0, penaltiesScored: 0 } },
  ...over,
});

const insights: PlayerInsights = {
  playerId: 'p1',
  season: { id: 's1', name: '2026/27', competitionName: 'OK Liga Masculina', startDate: null },
  metrics: [
    { kind: 'goals_per_match', value: 1.4, rank: 2, percentile: 98, peers: 180 },
    { kind: 'assists_per_match', value: 0.6, rank: 20, percentile: 70, peers: 180 },
  ],
  facts: { goals: 14, teamGoals: 50, goalSharePct: 28, scorerRank: 2, scoringStreak: 4, hatTricks: 1 },
};

describe('playerShareCard', () => {
  it('identidad: nombre legible, dorsal, equipo y temporada', () => {
    const c = playerShareCard(detail(), insights, { locale: 'es' });
    expect(c).toMatchObject({
      firstName: 'Ferran', lastName: 'Font', number: 9, teamId: 't1', team: 'FC Barcelona',
      competition: 'OK Liga Masculina', season: '2026/27', goalkeeper: false,
    });
  });

  it('cifras de temporada con goles por partido redondeado', () => {
    const c = playerShareCard(detail(), insights, { locale: 'es' });
    expect(c.hero).toEqual({ value: '14', label: 'Goles' });
    expect(c.stats.map((s) => [s.label, s.value])).toEqual([
      ['PJ', '10'], ['Asist.', '6'], ['Goles/PJ', '1,4'], ['Penaltis', '4/5'],
    ]);
  });

  it('destacados: puesto de goleador, cuota del equipo, racha y hat-tricks', () => {
    const c = playerShareCard(detail(), insights, { locale: 'es' });
    expect(c.highlights).toEqual(['2.º máximo goleador', '28 % de los goles del equipo', 'Marca en 4 partidos seguidos', '1 hat-trick']);
  });

  it('portero: el dato grande son los partidos y no hay goles por partido', () => {
    const c = playerShareCard(detail({
      player: { ...detail().player, isGoalkeeper: true },
      seasonTotals: { pj: 12, goals: 0, assists: 1, blueCards: 1, redCards: 0, penaltiesTotal: 0, penaltiesScored: 0 },
    }), null, { locale: 'es' });
    expect(c.goalkeeper).toBe(true);
    expect(c.hero).toEqual({ value: '12', label: 'Partidos' });
    expect(c.stats.map((s) => s.label)).toEqual(['Asist.', 'Azules', 'Rojas']);
    expect(c.highlights).toEqual([]);
  });

  it('sin insights ni equipo actual no falla', () => {
    const c = playerShareCard(detail({ currentTeam: null }), null, { locale: 'en' });
    expect(c.team).toBeNull();
    expect(c.season).toBeNull();
    expect(c.hero.label).toBe('Goals');
  });
});

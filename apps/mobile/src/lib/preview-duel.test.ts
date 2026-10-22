import { describe, it, expect } from 'vitest';
import { duelBar, headToHeadBalance } from './preview-duel';

describe('duelBar', () => {
  it('reparte la barra en proporción y marca al mejor', () => {
    expect(duelBar({ key: 'goals_per_match', home: 3, away: 1, unit: 'per_match' })).toEqual({
      key: 'goals_per_match',
      homeShare: 0.75,
      awayShare: 0.25,
      better: 'home',
    });
  });
  it('en faltas, tarjetas y minutos por gol gana quien tiene menos', () => {
    expect(duelBar({ key: 'fouls', home: 10, away: 6, unit: 'per_match' }).better).toBe('away');
    expect(duelBar({ key: 'minutes_goal', home: 12, away: 20, unit: 'minutes' }).better).toBe('home');
  });
  it('minutos por gol encajado: más es mejor', () => {
    expect(duelBar({ key: 'minutes_conceded', home: 25, away: 18, unit: 'minutes' }).better).toBe('home');
  });
  it('sin dato, empate o métrica neutra no hay mejor', () => {
    expect(duelBar({ key: 'penalty_pct', home: null, away: 50, unit: 'pct' }).better).toBeNull();
    expect(duelBar({ key: 'cards', home: 1, away: 1, unit: 'per_match' }).better).toBeNull();
    expect(duelBar({ key: 'direct_fouls', home: 2, away: 1, unit: 'per_match' }).better).toBeNull();
    expect(duelBar({ key: 'cards', home: 0, away: 0, unit: 'per_match' }).homeShare).toBe(0.5);
  });
});

describe('headToHeadBalance', () => {
  it('victorias y goles desde el punto de vista del local de la previa', () => {
    const b = headToHeadBalance(
      [
        { id: '1', date: null, homeTeamId: 'A', awayTeamId: 'B', homeName: '', awayName: '', homeScore: 3, awayScore: 1 },
        { id: '2', date: null, homeTeamId: 'B', awayTeamId: 'A', homeName: '', awayName: '', homeScore: 4, awayScore: 2 },
        { id: '3', date: null, homeTeamId: 'B', awayTeamId: 'A', homeName: '', awayName: '', homeScore: 2, awayScore: 2 },
      ],
      'A',
    );
    expect(b).toEqual({ homeWins: 1, draws: 1, awayWins: 1, homeGoals: 7, awayGoals: 7 });
  });
});

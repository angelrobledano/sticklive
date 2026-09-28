import { describe, it, expect } from 'vitest';
import type { Match } from '@/lib/api/client';
import { diffLiveScores } from './MatchesView';

/**
 * #361: la home debe anunciar los goles/estado del directo sin spamear. El diff
 * solo devuelve cambios de partidos que YA estaban en la lista (ignora altas y
 * bajas) y no anuncia correcciones de partidos ya finalizados.
 */
const m = (over: Partial<Match>) => ({
  id: 'x',
  seasonId: 's',
  roundId: null,
  status: 'live',
  scheduledAt: null,
  startedAt: null,
  finishedAt: null,
  score: { home: 0, away: 0 },
  venue: null,
  homeTeamId: 'h',
  awayTeamId: 'a',
  homeTeam: { id: 'h', name: 'Local Fútbol Club', shortName: 'LOC' },
  awayTeam: { id: 'a', name: 'Visitante', shortName: 'VIS' },
  sourceRef: null,
  ...over,
} as Match);

describe('diffLiveScores (#361)', () => {
  it('sin cambios no anuncia nada', () => {
    const prev = [m({ id: '1', score: { home: 1, away: 0 } })];
    const next = [m({ id: '1', score: { home: 1, away: 0 } })];
    expect(diffLiveScores(prev, next)).toEqual([]);
  });

  it('un gol en un partido en directo se anuncia con equipo y marcador', () => {
    const prev = [m({ id: '1', score: { home: 0, away: 0 } })];
    const next = [m({ id: '1', score: { home: 1, away: 0 } })];
    expect(diffLiveScores(prev, next)).toEqual([
      { id: '1', homeName: 'LOC', awayName: 'VIS', home: 1, away: 0, kind: 'goal' },
    ]);
  });

  it('un partido nuevo en la lista no se anuncia (evita ruido)', () => {
    const prev: Match[] = [];
    const next = [m({ id: '1', score: { home: 2, away: 1 } })];
    expect(diffLiveScores(prev, next)).toEqual([]);
  });

  it('el paso a directo se anuncia como inicio', () => {
    const prev = [m({ id: '1', status: 'scheduled' })];
    const next = [m({ id: '1', status: 'live' })];
    expect(diffLiveScores(prev, next)[0]).toMatchObject({ id: '1', kind: 'start' });
  });

  it('el final se anuncia como fin', () => {
    const prev = [m({ id: '1', status: 'live', score: { home: 3, away: 2 } })];
    const next = [m({ id: '1', status: 'finished', score: { home: 3, away: 2 } })];
    expect(diffLiveScores(prev, next)[0]).toMatchObject({ id: '1', kind: 'end' });
  });

  it('una corrección de un partido ya finalizado no se anuncia como gol', () => {
    const prev = [m({ id: '1', status: 'finished', score: { home: 3, away: 2 } })];
    const next = [m({ id: '1', status: 'finished', score: { home: 3, away: 3 } })];
    expect(diffLiveScores(prev, next)).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import { compare } from './monitor-directo';

const now = new Date('2026-10-31T17:00:00Z');
const ours = (o: Record<string, unknown>) => ({
  id: 'm', status: 'scheduled', scheduledAt: '2026-10-31T15:10:00.000Z', competitionName: 'OK Liga Masculina',
  homeTeam: { name: 'REUS DEPORTIU BRASILIA', shortName: 'REUS' }, awayTeam: { name: 'CALAFELL', shortName: 'CAL' },
  score: { home: null, away: null }, ...o,
});
const src = (o: Record<string, unknown>) => ({
  fuente: 'fep', competition: 'OK LIGA MASCULINA', home: 'REUS', away: 'CPC', status: 'live',
  homeScore: 2, awayScore: 1, scheduledAt: '2026-10-31T15:10:00.000Z', ...o,
});

describe('monitor del directo', () => {
  it('fuente en juego y nosotros programado', () => {
    expect(compare([src({})], [ours({}) as never], now).map((i) => i.tipo)).toEqual(['no_entra_directo']);
  });
  it('terminado en la fuente y colgado en juego con marcador imposible', () => {
    const tipos = compare([src({ status: 'finished', homeScore: 0, awayScore: 5 })],
      [ours({ status: 'live', startedAt: '2026-10-31T12:00:00Z', score: { home: 0, away: 42 } }) as never], now).map((i) => i.tipo);
    expect(tipos).toEqual(expect.arrayContaining(['no_se_cierra', 'marcador_distinto', 'directo_colgado', 'marcador_imposible']));
  });
  it('todo bien: sin incidencias', () => {
    expect(compare([src({})], [ours({ status: 'live', startedAt: '2026-10-31T15:10:00Z', score: { home: 2, away: 1 } }) as never], now)).toEqual([]);
  });
});

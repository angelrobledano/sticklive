import { describe, it, expect } from 'vitest';
import { goalMinute, matchShareCard, shareSiteHost } from './match-share-card';
import type { MatchDetail, MatchEvent } from './api/types';

const goal = (id: string, home: boolean, last: string, extra: Partial<MatchEvent> = {}): MatchEvent => ({
  id, eventType: 'goal', minute: null, period: 1, teamId: null, isHomeTeam: home, detail: null,
  player: { id: `p-${last}`, firstName: 'X', lastName: last }, ...extra,
});

function detail(over: Partial<MatchDetail['match']> = {}, events: MatchEvent[] = []): MatchDetail {
  return {
    match: {
      id: 'm1', seasonId: 's1', roundId: null, status: 'finished',
      scheduledAt: '2026-10-18T16:00:00Z', startedAt: null, finishedAt: null,
      score: { home: 5, away: 3 }, venue: null, homeTeamId: 'h', awayTeamId: 'a',
      homeTeam: { id: 'h', name: 'CALAFELL LA MENORQUINA', shortName: 'CALAFELL', logoUrl: null } as never,
      awayTeam: { id: 'a', name: 'FC BARCELONA', shortName: 'BARÇA', logoUrl: null } as never,
      sourceRef: null, competitionName: 'OK Liga Masculina', referee: null,
      round: { name: null, number: 7, type: 'regular', stage: null } as never,
      ...over,
    },
    events, stats: {} as never, lineups: {} as never,
  };
}

describe('matchShareCard', () => {
  it('resultado final: marcador, competición con jornada y nombres de club', () => {
    const c = matchShareCard(detail(), { locale: 'es' });
    expect(c).toMatchObject({
      state: 'finished', competition: 'OK Liga Masculina', round: 'Jornada 7',
      home: { id: 'h', name: 'Calafell la Menorquina', score: 5 },
      away: { id: 'a', name: 'FC Barcelona', score: 3 },
      note: null,
    });
  });

  it('goleadores por equipo con el minuto de cada gol, ordenados por primer gol', () => {
    const c = matchShareCard(detail({}, [
      goal('1', true, 'FONT SANCHEZ', { period: 2, clock: '10:00' }),
      goal('2', false, 'PASCUAL', { period: 1, clock: '20:30' }),
      goal('3', true, 'ROCA', { period: 1, clock: '24:10' }),
      goal('4', true, 'FONT SANCHEZ', { period: 1, clock: '05:00' }),
      { ...goal('5', true, 'X'), eventType: 'blue_card' },
    ]), { locale: 'es' });
    expect(c.home.scorers).toEqual([
      { name: 'Roca', minutes: [1] },
      { name: 'Font', minutes: [21, 41] },
    ]);
    expect(c.away.scorers).toEqual([{ name: 'Pascual', minutes: [5] }]);
  });

  it('prórroga y penaltis dejan nota', () => {
    expect(matchShareCard(detail({ winType: 'overtime' }), { locale: 'es' }).note).toBe('Prórroga')
    const pen = matchShareCard(detail({ winType: 'penalties', score: { home: 4, away: 4 }, penalties: { home: 3, away: 2 } }), { locale: 'es' });
    expect(pen.note).toBe('Penaltis 3–2');
  });

  it('partido por jugar: sin marcador y con fecha en la zona de la competición', () => {
    const c = matchShareCard(detail({ status: 'scheduled', score: { home: null, away: null }, competitionTimezone: 'Europe/Madrid' }), { locale: 'es' });
    expect(c.state).toBe('scheduled');
    expect(c.home.score).toBeNull();
    expect(c.when).toMatch(/18 oct.*18:00/);
  });

  it('en directo', () => {
    expect(matchShareCard(detail({ status: 'live' }), { locale: 'en' }).state).toBe('live');
  });
});

describe('goalMinute', () => {
  it('desde el crono restante de cada parte', () => {
    expect(goalMinute({ period: 1, clock: '25:00', minute: null })).toBe(1);
    expect(goalMinute({ period: 1, clock: '00:10', minute: null })).toBe(25);
    expect(goalMinute({ period: 2, clock: '12:30', minute: null })).toBe(38);
  });
  it('prórroga de 5 minutos', () => {
    expect(goalMinute({ period: 3, clock: '02:00', minute: null })).toBe(54);
  });
  it('sin crono usa el minuto transcurrido de la parte', () => {
    expect(goalMinute({ period: 2, clock: null, minute: 7 })).toBe(32);
    expect(goalMinute({ period: 2, clock: null, minute: 40 })).toBe(40);
    expect(goalMinute({ period: 1, clock: null, minute: null })).toBeNull();
  });
});

describe('shareSiteHost', () => {
  it('solo el dominio, sin protocolo ni ruta', () => {
    expect(shareSiteHost('https://sticklive.eu')).toBe('sticklive.eu');
    expect(shareSiteHost('https://www.sticklive.eu/es/teams/x')).toBe('sticklive.eu');
  });
});

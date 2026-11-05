import { describe, it, expect } from 'vitest';
import { favoriteTeamCards, type CardMatch } from './favorites-view';

/**
 * Favoritos como pantalla de consumo (05/11/2026, patrón FotMob «Following»):
 * cada equipo seguido con su directo, su próximo partido o su último resultado.
 */
const NOW = Date.parse('2026-11-05T12:00:00Z');
const m = (id: string, home: string, away: string, iso: string, status: string): CardMatch => ({
  id, status, scheduledAt: iso,
  homeTeam: { id: home, name: `Equipo ${home}` }, awayTeam: { id: away, name: `Equipo ${away}` },
  score: { home: status === 'scheduled' ? null : 1, away: status === 'scheduled' ? null : 0 },
});

describe('favoriteTeamCards', () => {
  const matches = [
    m('a1', 'reus', 'noia', '2026-10-31T17:00:00Z', 'finished'),
    m('a2', 'riv', 'reus', '2026-11-07T18:00:00Z', 'scheduled'),
    m('b1', 'liceo', 'barca', '2026-11-05T11:30:00Z', 'live'),
    m('c1', 'vic', 'igu', '2026-11-01T17:00:00Z', 'finished'),
  ];
  const cards = favoriteTeamCards(['vic', 'reus', 'liceo', 'nada'], matches, NOW, { nada: 'Sin Partidos CP' });

  it('en directo primero, después por próximo partido, después el resto', () => {
    expect(cards.map((c) => c.id)).toEqual(['liceo', 'reus', 'vic', 'nada']);
  });
  it('cada equipo con su directo, próximo y último', () => {
    const reus = cards.find((c) => c.id === 'reus')!;
    expect(reus.next?.id).toBe('a2');
    expect(reus.last?.id).toBe('a1');
    expect(cards[0]!.live?.id).toBe('b1');
  });
  it('nombre desde los partidos o, si no hay, desde el catálogo', () => {
    expect(cards.find((c) => c.id === 'reus')!.name).toBe('Equipo reus');
    expect(cards.find((c) => c.id === 'nada')!.name).toBe('Sin Partidos CP');
  });
});

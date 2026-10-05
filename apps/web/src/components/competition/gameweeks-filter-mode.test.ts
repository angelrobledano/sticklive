import { describe, it, expect } from 'vitest';
import { fixturesFilterMode, nearestMatchDay } from './GameweeksTab';
import type { SeasonMatch } from '@/lib/api/client';

function match(over: Partial<SeasonMatch> = {}): SeasonMatch {
  return {
    id: 'm1',
    status: 'scheduled',
    scheduledAt: null,
    startedAt: null,
    finishedAt: null,
    score: { home: null, away: null },
    venueName: null,
    roundId: null,
    roundNumber: null,
    roundName: null,
    roundType: 'regular',
    homeTeam: { id: 'h', name: 'Local', shortName: 'LOC', logoUrl: null },
    awayTeam: { id: 'a', name: 'Visitante', shortName: 'VIS', logoUrl: null },
    ...over,
  };
}

const iso = (day: string) => `${day}T12:00:00.000Z`;

describe('nearestMatchDay', () => {
  it('devuelve el día más cercano a hoy y su jornada', () => {
    const near = nearestMatchDay(
      [match({ id: 'a', roundNumber: 1, scheduledAt: iso('2026-09-20') }),
       match({ id: 'b', roundNumber: 2, scheduledAt: iso('2026-10-02') })],
      '2026-09-28',
    );
    expect(near).toEqual({ day: '2026-10-02', journey: 2 });
  });

  it('ignora partidos sin fecha y devuelve null si no hay ninguno', () => {
    expect(nearestMatchDay([match({ scheduledAt: null })], '2026-09-28')).toBeNull();
  });
});

describe('fixturesFilterMode', () => {
  const none = { journey: null, date: null, team: null };

  it('el parámetro explícito de la URL manda', () => {
    expect(fixturesFilterMode('team', { journey: 3, date: '2026-01-01', team: 't' }, 'round')).toBe('team');
    expect(fixturesFilterMode('date', none, 'round')).toBe('date');
    expect(fixturesFilterMode('round', none, 'date')).toBe('round');
  });

  it('sin parámetro, lo infiere del valor presente (compatibilidad con enlaces viejos)', () => {
    expect(fixturesFilterMode(null, { journey: null, date: null, team: 't1' }, 'round')).toBe('team');
    expect(fixturesFilterMode(null, { journey: null, date: '2026-01-01', team: null }, 'round')).toBe('date');
    expect(fixturesFilterMode(null, { journey: 4, date: null, team: null }, 'date')).toBe('round');
  });

  it('sin nada, usa el modo por defecto', () => {
    expect(fixturesFilterMode(null, none, 'date')).toBe('date');
    expect(fixturesFilterMode(null, none, 'round')).toBe('round');
  });

  it('ignora un valor de filtro desconocido', () => {
    expect(fixturesFilterMode('basura', none, 'date')).toBe('date');
  });
});

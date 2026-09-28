import { describe, it, expect } from 'vitest';
import { pickDefaultFilter } from './GameweeksTab';
import type { SeasonMatch, SeasonRound } from '@/lib/api/client';

/**
 * #157: la pestaña Jornadas debe abrir en un estado CON contenido. El defecto
 * anterior (última jornada jugada, o la primera ronda) dejaba vacía una
 * competición que aún no ha empezado y no trae `rounds`/`roundNumber`
 * (OK Liga 26/27: 182 partidos, la primera jornada el 31/10). Estas pruebas fijan
 * la elección del filtro inicial: el DÍA MÁS CERCANO con partidos.
 */

/** ISO a mediodía UTC: inmune a que Madrid cruce de día por el horario. */
function iso(day: string): string {
  return `${day}T12:00:00.000Z`;
}

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

function round(number: number, over: Partial<SeasonRound> = {}): SeasonRound {
  return { id: `r${number}`, number, name: null, roundType: 'regular', ...over };
}

describe('pickDefaultFilter (#157)', () => {
  it('sin rondas y sin roundNumber (OK Liga) cae a la fecha del próximo partido', () => {
    const matches = [
      match({ id: 'a', scheduledAt: iso('2026-10-31') }),
      match({ id: 'b', scheduledAt: iso('2026-11-07') }),
    ];
    expect(pickDefaultFilter([], matches, '2026-09-28')).toEqual({
      journey: null,
      date: '2026-10-31',
    });
  });

  it('con jornadas, elige la más próxima a hoy (aunque sea futura)', () => {
    const matches = [
      match({ id: 'a', roundNumber: 1, scheduledAt: iso('2026-09-20') }),
      match({ id: 'b', roundNumber: 2, scheduledAt: iso('2026-10-02') }),
    ];
    // 2026-09-20 queda a 8 días; 2026-10-02 a 4 → gana la jornada 2.
    expect(pickDefaultFilter([round(1), round(2)], matches, '2026-09-28')).toEqual({
      journey: 2,
      date: null,
    });
  });

  it('si todos son pasados, elige la jornada más reciente', () => {
    const matches = [
      match({ id: 'a', roundNumber: 5, scheduledAt: iso('2026-09-10') }),
      match({ id: 'b', roundNumber: 6, scheduledAt: iso('2026-09-25') }),
    ];
    expect(pickDefaultFilter([round(5), round(6)], matches, '2026-09-28')).toEqual({
      journey: 6,
      date: null,
    });
  });

  it('a igual distancia, prefiere el futuro (la próxima jornada)', () => {
    const matches = [
      match({ id: 'past', roundNumber: 7, scheduledAt: iso('2026-09-27') }),
      match({ id: 'next', roundNumber: 8, scheduledAt: iso('2026-09-29') }),
    ];
    expect(pickDefaultFilter([round(7), round(8)], matches, '2026-09-28')).toEqual({
      journey: 8,
      date: null,
    });
  });

  it('un partido en juego hoy ancla su jornada', () => {
    const matches = [
      match({ id: 'live', status: 'live', roundNumber: 4, scheduledAt: iso('2026-09-28') }),
      match({ id: 'far', roundNumber: 5, scheduledAt: iso('2026-10-20') }),
    ];
    expect(pickDefaultFilter([round(4), round(5)], matches, '2026-09-28')).toEqual({
      journey: 4,
      date: null,
    });
  });

  it('sin fechas, elige la primera jornada CON partidos, no la primera ronda', () => {
    const matches = [match({ id: 'a', roundNumber: 2 })];
    expect(pickDefaultFilter([round(1), round(2)], matches, '2026-09-28')).toEqual({
      journey: 2,
      date: null,
    });
  });

  it('sin datos cae a la primera ronda (no rompe)', () => {
    expect(pickDefaultFilter([round(1)], [], '2026-09-28')).toEqual({ journey: 1, date: null });
    expect(pickDefaultFilter([], [], '2026-09-28')).toEqual({ journey: 1, date: null });
  });
});

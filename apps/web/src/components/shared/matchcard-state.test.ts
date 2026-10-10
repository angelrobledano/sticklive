import { describe, it, expect } from 'vitest';
import type { Match } from '@/lib/api/client';
import { matchCardState } from './MatchCard';

/**
 * Estado que pinta la tarjeta de partido. El EN DIRECTO solo lo da la fuente:
 * antes (#366) un `scheduled` con la hora pasada se pintaba "En directo" 0-0
 * durante 5 h aunque el partido no hubiera empezado (retraso, aplazamiento,
 * hora mal publicada). Ahora la hora solo distingue pendiente/sin resultado.
 */

function match(over: Partial<Match>): Match {
  return {
    id: 'm1',
    seasonId: 's1',
    roundId: null,
    competitionId: null,
    competitionName: null,
    status: 'scheduled',
    scheduledAt: null,
    startedAt: null,
    finishedAt: null,
    score: { home: null, away: null },
    venue: null,
    homeTeamId: 'h',
    awayTeamId: 'a',
    sourceRef: null,
    ...over,
  } as Match;
}

const START = Date.parse('2026-06-20T18:00:00.000Z');
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

describe('matchCardState', () => {
  it('el estado explícito de la fuente manda', () => {
    expect(matchCardState(match({ status: 'live', scheduledAt: iso(START) }), START - HOUR)).toBe('live');
    expect(matchCardState(match({ status: 'finished', scheduledAt: iso(START) }), START + HOUR)).toBe('finished');
    expect(matchCardState(match({ status: 'postponed', scheduledAt: iso(START) }), START + HOUR)).toBe('postponed');
  });

  it('antes de la hora: programado', () => {
    expect(matchCardState(match({ scheduledAt: iso(START) }), START - HOUR)).toBe('scheduled');
  });

  it('pasada la hora sin señal de la fuente: pendiente de inicio, NUNCA en directo', () => {
    expect(matchCardState(match({ scheduledAt: iso(START) }), START + HOUR)).toBe('awaiting_start');
  });

  it('muy pasada la hora (≥ 5 h) sin resultado: sin resultado', () => {
    expect(matchCardState(match({ scheduledAt: iso(START) }), START + 5 * HOUR)).toBe('overdue');
  });

  it('cae a startedAt cuando no hay scheduledAt; sin fechas, programado', () => {
    expect(matchCardState(match({ scheduledAt: null, startedAt: iso(START) }), START + HOUR)).toBe('awaiting_start');
    expect(matchCardState(match({ scheduledAt: null, startedAt: null }), START)).toBe('scheduled');
  });
});

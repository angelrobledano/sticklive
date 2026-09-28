import { describe, it, expect } from 'vitest';
import type { Match } from '@/lib/api/client';
import { isMatchOverdue } from './MatchCard';

/**
 * #366: la decisión "un partido scheduled ya debería pintarse live" se extrajo
 * como función pura (`isMatchOverdue`) para poder fijarla sin navegador.
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

describe('isMatchOverdue', () => {
  it('solo aplica a partidos en estado scheduled', () => {
    expect(isMatchOverdue(match({ status: 'live', scheduledAt: iso(START) }), START + HOUR)).toBe(false);
    expect(isMatchOverdue(match({ status: 'finished', scheduledAt: iso(START) }), START + HOUR)).toBe(false);
  });

  it('antes (o justo en) la hora de inicio no fuerza live', () => {
    expect(isMatchOverdue(match({ scheduledAt: iso(START) }), START - HOUR)).toBe(false);
    expect(isMatchOverdue(match({ scheduledAt: iso(START) }), START)).toBe(false);
  });

  it('dentro de la ventana realista fuerza live', () => {
    expect(isMatchOverdue(match({ scheduledAt: iso(START) }), START + HOUR)).toBe(true);
  });

  it('más allá de STALE_LIVE_HOURS (5 h) deja de forzar', () => {
    expect(isMatchOverdue(match({ scheduledAt: iso(START) }), START + 5 * HOUR)).toBe(false);
    expect(isMatchOverdue(match({ scheduledAt: iso(START) }), START + 5 * HOUR + 1)).toBe(false);
  });

  it('cae a startedAt cuando no hay scheduledAt', () => {
    expect(isMatchOverdue(match({ scheduledAt: null, startedAt: iso(START) }), START + HOUR)).toBe(true);
  });

  it('sin fechas no fuerza', () => {
    expect(isMatchOverdue(match({ scheduledAt: null, startedAt: null }), START)).toBe(false);
  });
});

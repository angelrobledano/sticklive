import { describe, it, expect } from 'vitest';
import {
  planScheduledRefetch,
  REFETCH_LEAD_MS,
  REFETCH_HORIZON_MS,
  REFETCH_GRACE_MS,
} from './MatchCenterClient';

/**
 * #366: el re-fetch de la ficha de un partido 'scheduled' dejó de ser
 * incondicional al abrir. `planScheduledRefetch` (pura) decide si se consulta
 * enseguida y si se programa un temporizador tras el inicio.
 */

const NOW = Date.parse('2026-06-20T18:00:00.000Z');
const MIN = 60_000;
const HOUR = 3_600_000;
const iso = (delta: number) => new Date(NOW + delta).toISOString();

describe('planScheduledRefetch', () => {
  it('sin hora de inicio no hace nada', () => {
    expect(planScheduledRefetch(null, NOW)).toEqual({ refetchNow: false, timeoutMs: null });
    expect(planScheduledRefetch(undefined, NOW)).toEqual({ refetchNow: false, timeoutMs: null });
    expect(planScheduledRefetch('', NOW)).toEqual({ refetchNow: false, timeoutMs: null });
  });

  it('partido lejano (>6 h): ni fetch inmediato ni temporizador', () => {
    expect(planScheduledRefetch(iso(REFETCH_HORIZON_MS + HOUR), NOW)).toEqual({
      refetchNow: false,
      timeoutMs: null,
    });
  });

  it('partido dentro del horizonte: no consulta aún pero programa tras el inicio', () => {
    const r = planScheduledRefetch(iso(3 * HOUR), NOW);
    expect(r.refetchNow).toBe(false);
    expect(r.timeoutMs).toBe(3 * HOUR + REFETCH_GRACE_MS);
  });

  it('el margen de adelanto marca el límite del fetch inmediato', () => {
    expect(planScheduledRefetch(iso(REFETCH_LEAD_MS), NOW).refetchNow).toBe(true);
    expect(planScheduledRefetch(iso(REFETCH_LEAD_MS + 1), NOW).refetchNow).toBe(false);
  });

  it('inicio inminente: fetch inmediato y temporizador', () => {
    const r = planScheduledRefetch(iso(2 * MIN), NOW);
    expect(r.refetchNow).toBe(true);
    expect(r.timeoutMs).toBe(2 * MIN + REFETCH_GRACE_MS);
  });

  it('inicio ya pasado: fetch inmediato sin temporizador', () => {
    expect(planScheduledRefetch(iso(-HOUR), NOW)).toEqual({ refetchNow: true, timeoutMs: null });
    expect(planScheduledRefetch(iso(0), NOW)).toEqual({ refetchNow: true, timeoutMs: null });
  });

  it('el límite superior del horizonte (6 h exactas) aún programa', () => {
    expect(planScheduledRefetch(iso(REFETCH_HORIZON_MS), NOW).timeoutMs).toBe(
      REFETCH_HORIZON_MS + REFETCH_GRACE_MS,
    );
  });
});

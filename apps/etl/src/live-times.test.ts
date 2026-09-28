import { describe, it, expect } from 'vitest';
import { resolveLiveTimeStamps } from './live-times.js';

/**
 * #189 + #377(P3-11): sellos de inicio/fin del flujo de directo.
 */
describe('resolveLiveTimeStamps', () => {
  const at = new Date('2026-09-27T18:00:00Z');
  const scheduled = new Date('2026-09-27T17:30:00Z');

  it('live → sella startedAt con el instante de scrapeo', () => {
    expect(resolveLiveTimeStamps('live', scheduled, at)).toEqual({ startedAt: at });
  });

  it('finished sin inicio previsto → sella finishedAt y startedAt = scheduled_at', () => {
    expect(resolveLiveTimeStamps('finished', scheduled, at)).toEqual({
      startedAt: scheduled,
      finishedAt: at,
    });
  });

  it('finished sin hora programada → sólo finishedAt (no inventa inicio)', () => {
    expect(resolveLiveTimeStamps('finished', undefined, at)).toEqual({ finishedAt: at });
  });

  it('scheduled/postponed → no sella nada', () => {
    expect(resolveLiveTimeStamps('scheduled', scheduled, at)).toEqual({});
    expect(resolveLiveTimeStamps('postponed', scheduled, at)).toEqual({});
  });
});

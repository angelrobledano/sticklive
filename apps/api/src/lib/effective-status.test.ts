import { describe, it, expect } from 'vitest';
import { effectiveMatchStatus } from './effective-status.js';

const H = 3_600_000;
const ahora = Date.parse('2026-09-27T18:00:00Z');

describe('effectiveMatchStatus', () => {
  it('respeta los estados terminales', () => {
    for (const s of ['finished', 'postponed', 'cancelled']) {
      expect(effectiveMatchStatus(s, new Date(ahora - H), ahora)).toBe(s);
    }
  });

  it('adelanta a live un scheduled recién empezado (lag de la fuente)', () => {
    expect(effectiveMatchStatus('scheduled', new Date(ahora - 5 * 60_000), ahora)).toBe('live');
  });

  it('#150 pasadas STALE_LIVE_HOURS ya NO se pinta EN VIVO un fantasma', () => {
    expect(effectiveMatchStatus('scheduled', new Date(ahora - 6 * H), ahora)).toBe('scheduled');
  });

  it('un live de la fuente sigue siendo live', () => {
    expect(effectiveMatchStatus('live', new Date(ahora - 10 * H), ahora)).toBe('live');
  });

  it('sin fecha no adelanta', () => {
    expect(effectiveMatchStatus('scheduled', null, ahora)).toBe('scheduled');
  });
});

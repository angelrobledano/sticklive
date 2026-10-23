import { describe, it, expect } from 'vitest';
import { loopDecision } from './live-yield.js';

const MIN = 60_000;

describe('loopDecision', () => {
  it('sigue mientras no llega a la cesión', () => {
    expect(loopDecision(10 * MIN, 60 * MIN, 180 * MIN)).toBe('continue');
  });
  it('cede al pasar LIVE_YIELD_MIN', () => {
    expect(loopDecision(61 * MIN, 60 * MIN, 180 * MIN)).toBe('yield');
  });
  it('el tope de seguridad manda sobre la cesión', () => {
    expect(loopDecision(181 * MIN, 60 * MIN, 180 * MIN)).toBe('stop');
  });
  it('LIVE_YIELD_MIN=0 desactiva la cesión (comportamiento anterior)', () => {
    expect(loopDecision(170 * MIN, 0, 180 * MIN)).toBe('continue');
  });
});

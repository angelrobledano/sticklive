import { describe, it, expect } from 'vitest';
import { isStatusRegression } from './status-regression.js';

describe('isStatusRegression', () => {
  it('detecta una regresión finished/live → scheduled', () => {
    expect(isStatusRegression('finished', 'scheduled')).toBe(true);
    expect(isStatusRegression('live', 'scheduled')).toBe(true);
  });

  it('#377(P3-9): detecta la reapertura finished → live', () => {
    expect(isStatusRegression('finished', 'live')).toBe(true);
  });

  it('no marca transiciones normales', () => {
    expect(isStatusRegression('scheduled', 'live')).toBe(false);
    expect(isStatusRegression('live', 'finished')).toBe(false);
    expect(isStatusRegression('scheduled', 'scheduled')).toBe(false);
    expect(isStatusRegression('finished', 'finished')).toBe(false);
    expect(isStatusRegression('live', 'live')).toBe(false);
  });

  it('no marca cuando no había estado previo (alta nueva)', () => {
    expect(isStatusRegression(null, 'scheduled')).toBe(false);
    expect(isStatusRegression(undefined, 'scheduled')).toBe(false);
  });
});

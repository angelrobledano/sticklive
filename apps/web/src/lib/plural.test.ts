import { describe, it, expect } from 'vitest';
import { pickPlural } from './plural';

/** Auditoría UX #14: «1 resultados», «1 puntos». */
describe('pickPlural', () => {
  it('1 → singular, resto → plural (también 0)', () => {
    expect(pickPlural(1, 'uno', 'otros')).toBe('uno');
    expect(pickPlural(0, 'uno', 'otros')).toBe('otros');
    expect(pickPlural(7, 'uno', 'otros')).toBe('otros');
  });
});

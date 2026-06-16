import { describe, it, expect } from 'vitest';
import { isPremiumActive } from './premium.js';

describe('isPremiumActive', () => {
  const now = new Date('2026-06-16T12:00:00Z');

  it('null/undefined → no premium', () => {
    expect(isPremiumActive(null, now)).toBe(false);
    expect(isPremiumActive(undefined, now)).toBe(false);
  });

  it('fecha futura → premium activo', () => {
    expect(isPremiumActive('2027-06-16T12:00:00Z', now)).toBe(true);
  });

  it('fecha pasada → premium caducado (lo que antes no se reflejaba)', () => {
    expect(isPremiumActive('2026-06-15T12:00:00Z', now)).toBe(false);
  });

  it('acepta Date además de string', () => {
    expect(isPremiumActive(new Date('2027-01-01T00:00:00Z'), now)).toBe(true);
  });

  it('fecha inválida → no premium', () => {
    expect(isPremiumActive('basura', now)).toBe(false);
  });
});

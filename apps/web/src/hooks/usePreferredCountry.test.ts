import { describe, it, expect } from 'vitest';
import { ALL_COUNTRIES, resolveCountry } from './usePreferredCountry';

describe('resolveCountry', () => {
  it('«Todos los países» elegido no vuelve al país sugerido por el navegador', () => {
    expect(resolveCountry(ALL_COUNTRIES, 'ES')).toBeNull();
  });
  it('un país elegido manda sobre la sugerencia', () => {
    expect(resolveCountry('PT', 'ES')).toBe('PT');
  });
  it('sin elección se usa la sugerencia', () => {
    expect(resolveCountry(null, 'ES')).toBe('ES');
  });
});

import { describe, it, expect } from 'vitest';
import { normalizeSearchText } from './search-text';

describe('normalizeSearchText', () => {
  it('pasa a minúsculas y quita acentos', () => {
    expect(normalizeSearchText('Primera División')).toBe('primera division');
    expect(normalizeSearchText('Copa del Rey')).toBe('copa del rey');
  });

  it('`patin` encuentra PATÍN, `mataro` MATARÓ e `iruna` IRUÑA', () => {
    expect(normalizeSearchText('PATÍN')).toBe('patin');
    expect(normalizeSearchText('MATARÓ')).toBe('mataro');
    expect(normalizeSearchText('IRUÑA')).toBe('iruna');
  });

  it('una cadena vacía sigue vacía', () => {
    expect(normalizeSearchText('')).toBe('');
  });
});

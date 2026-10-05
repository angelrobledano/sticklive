import { describe, it, expect } from 'vitest';
import { deriveShortName } from './derive-short-name.js';

describe('deriveShortName — abreviatura de respaldo', () => {
  it('usa la última palabra de club (la ciudad/entidad)', () => {
    expect(deriveShortName('AMETLLER ORIGEN CP VILAFRANCA')).toBe('VIL');
    expect(deriveShortName('HC RAXOI')).toBe('RAX');
    expect(deriveShortName('BARÇA')).toBe('BAR');
  });

  it('salta siglas de club y sufijos de filial cortos', () => {
    expect(deriveShortName('CLUB PATIN ALCOBENDAS B')).toBe('ALC');
    expect(deriveShortName('CP')).toBe('');
  });

  it('sin nombre devuelve vacío', () => {
    expect(deriveShortName('')).toBe('');
    expect(deriveShortName('   ')).toBe('');
  });
});

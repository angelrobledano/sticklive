import { describe, it, expect } from 'vitest';
import { isCountryCode, suggestCountry } from './country-pref';

describe('country-pref', () => {
  it('valida códigos ISO de dos letras mayúsculas', () => {
    expect(isCountryCode('ES')).toBe(true);
    expect(isCountryCode('PT')).toBe(true);
    expect(isCountryCode('IT')).toBe(true);
    expect(isCountryCode('es')).toBe(false);
    expect(isCountryCode('ESP')).toBe(false);
    expect(isCountryCode('')).toBe(false);
    expect(isCountryCode(null)).toBe(false);
    expect(isCountryCode(123)).toBe(false);
  });

  it('sugiere país a partir de la región del tag de idioma', () => {
    const available = ['ES', 'PT', 'IT'];
    expect(suggestCountry(['es-ES'], available)).toBe('ES');
    expect(suggestCountry(['ca-ES'], available)).toBe('ES');
    expect(suggestCountry(['pt-PT'], available)).toBe('PT');
    expect(suggestCountry(['it-IT'], available)).toBe('IT');
    expect(suggestCountry(['es_ES'], available)).toBe('ES');
  });

  it('ignora idiomas sin región o regiones no disponibles', () => {
    const available = ['ES', 'PT', 'IT'];
    expect(suggestCountry(['es'], available)).toBeNull();
    expect(suggestCountry(['pt-BR'], available)).toBeNull();
    expect(suggestCountry(['en-US'], available)).toBeNull();
  });
});

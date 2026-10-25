import { describe, it, expect } from 'vitest';
import { suggestCountry, isCountryCode } from './country-pref';

const AVAILABLE = ['ES', 'PT', 'IT'];

/** País preferido (plan 2026-10-25, iteración 4): la región, nunca solo el idioma. */
describe('suggestCountry', () => {
  it.each([
    [['pt-PT'], 'PT'],
    [['es-ES', 'en'], 'ES'],
    [['it-IT'], 'IT'],
    [['en-GB', 'pt-PT'], 'PT'],
  ])('%j → %s', (langs, c) => {
    expect(suggestCountry(langs, AVAILABLE)).toBe(c);
  });
  it.each([
    [['pt-BR']], [['es-AR']], [['pt']], [['es']], [['en-US']], [[]],
  ])('%j no sugiere nada (idioma ≠ país, o país sin competiciones)', (langs) => {
    expect(suggestCountry(langs, AVAILABLE)).toBeNull();
  });
});

describe('isCountryCode', () => {
  it('acepta ISO-2 en mayúsculas y rechaza lo demás', () => {
    expect(isCountryCode('PT')).toBe(true);
    expect(isCountryCode('pt')).toBe(false);
    expect(isCountryCode('W')).toBe(false);
    expect(isCountryCode('ESP')).toBe(false);
    expect(isCountryCode(null)).toBe(false);
  });
});

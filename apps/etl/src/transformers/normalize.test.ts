import { describe, it, expect } from 'vitest';
import { normalizeTeamName } from './normalize.js';

describe('normalizeTeamName', () => {
  it('quita el sponsor y la filial: "Coinasa Liceo B" → "liceo"', () => {
    expect(normalizeTeamName('Coinasa Liceo B', ['Coinasa'])).toBe('liceo');
  });

  it('NO toca palabras genéricas: "Deportivo Liceo" → "deportivo liceo"', () => {
    // Unir esto con "Coinasa Liceo" es fuzzy + HITL, no normalización.
    expect(normalizeTeamName('Deportivo Liceo')).toBe('deportivo liceo');
  });

  it('quita diacríticos y puntuación', () => {
    expect(normalizeTeamName('C.P. Voltregà')).toBe('c p voltrega');
    expect(normalizeTeamName('Igualada HC')).toBe('igualada hc');
  });

  it('quita la filial de una letra solo si es el último token', () => {
    expect(normalizeTeamName('CH Caldes B')).toBe('ch caldes');
    expect(normalizeTeamName('Liceo')).toBe('liceo');
  });

  it('quita género/categoría en ES/CAT/PT/IT', () => {
    expect(normalizeTeamName('Girona CH Femenino')).toBe('girona ch');
    expect(normalizeTeamName('CP Manlleu Femení')).toBe('cp manlleu');
  });

  it('quita categorías por edad tipo sub-NN', () => {
    expect(normalizeTeamName('Reus Deportiu Sub-17')).toBe('reus deportiu');
    expect(normalizeTeamName('Reus Sub17')).toBe('reus');
  });

  it('el sponsor se compara sin acentos ni mayúsculas', () => {
    expect(normalizeTeamName('Coinasa Liceo', ['coinasa'])).toBe('liceo');
  });

  it('nunca devuelve vacío aunque todo sean tokens de ruido', () => {
    expect(normalizeTeamName('B')).toBe('b');
    expect(normalizeTeamName('FEM')).toBe('fem');
  });
});

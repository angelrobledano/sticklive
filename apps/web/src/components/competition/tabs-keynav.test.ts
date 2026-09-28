import { describe, it, expect } from 'vitest';
import { nextTabIndex } from './CompetitionClient';
import { nextTabIndex as nextTabIndexList } from './CompetitionsList';

/**
 * #358: navegación por teclado del patrón ARIA tabs (roving tabindex) en la
 * página de competición y en el listado. Lógica pura, fijada sin navegador.
 */
describe.each([
  ['CompetitionClient', nextTabIndex],
  ['CompetitionsList', nextTabIndexList],
])('nextTabIndex (%s, #358)', (_name, next) => {
  it('ArrowRight/ArrowDown avanzan y envuelven al principio', () => {
    expect(next(0, 'ArrowRight', 3)).toBe(1);
    expect(next(2, 'ArrowRight', 3)).toBe(0);
    expect(next(0, 'ArrowDown', 2)).toBe(1);
  });

  it('ArrowLeft/ArrowUp retroceden y envuelven al final', () => {
    expect(next(0, 'ArrowLeft', 3)).toBe(2);
    expect(next(2, 'ArrowLeft', 3)).toBe(1);
    expect(next(0, 'ArrowUp', 2)).toBe(1);
  });

  it('Home y End van a los extremos', () => {
    expect(next(1, 'Home', 4)).toBe(0);
    expect(next(1, 'End', 4)).toBe(3);
  });

  it('una tecla no gestionada no mueve el foco', () => {
    expect(next(1, 'Enter', 3)).toBe(1);
    expect(next(1, 'Tab', 3)).toBe(1);
  });

  it('sin tabs no hay destino', () => {
    expect(next(0, 'ArrowRight', 0)).toBe(-1);
  });
});

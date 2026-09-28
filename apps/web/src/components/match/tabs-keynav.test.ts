import { describe, it, expect } from 'vitest';
import { nextTabIndex } from './MatchCenterClient';

/**
 * #358: navegación por teclado del patrón ARIA tabs (roving tabindex) en el
 * centro de partido. Lógica pura, fijada sin navegador.
 */
describe('nextTabIndex (MatchCenterClient, #358)', () => {
  it('ArrowRight/ArrowDown avanzan y envuelven al principio', () => {
    expect(nextTabIndex(0, 'ArrowRight', 3)).toBe(1);
    expect(nextTabIndex(2, 'ArrowRight', 3)).toBe(0);
    expect(nextTabIndex(0, 'ArrowDown', 2)).toBe(1);
  });

  it('ArrowLeft/ArrowUp retroceden y envuelven al final', () => {
    expect(nextTabIndex(0, 'ArrowLeft', 3)).toBe(2);
    expect(nextTabIndex(2, 'ArrowLeft', 3)).toBe(1);
    expect(nextTabIndex(0, 'ArrowUp', 2)).toBe(1);
  });

  it('Home y End van a los extremos', () => {
    expect(nextTabIndex(1, 'Home', 4)).toBe(0);
    expect(nextTabIndex(1, 'End', 4)).toBe(3);
  });

  it('una tecla no gestionada no mueve el foco', () => {
    expect(nextTabIndex(1, 'Enter', 3)).toBe(1);
  });

  it('sin tabs no hay destino', () => {
    expect(nextTabIndex(0, 'ArrowRight', 0)).toBe(-1);
  });
});

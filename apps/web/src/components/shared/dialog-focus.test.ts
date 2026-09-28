import { describe, it, expect } from 'vitest';
import { trapFocusIndex } from './NotificationPresetSheet';
import { trapFocusIndex as trapFocusIndexAuth } from './AuthUpsell';

/**
 * #359: el trap de foco de los diálogos modales envuelve de final→principio y de
 * principio→final. La lógica de índices es pura y se fija aquí para los dos
 * diálogos que la implementan (NotificationPresetSheet y AuthUpsell).
 */
describe.each([
  ['NotificationPresetSheet', trapFocusIndex],
  ['AuthUpsell', trapFocusIndexAuth],
])('trapFocusIndex (%s, #359)', (_name, trap) => {
  it('sin elementos no hay destino', () => {
    expect(trap(0, 0, false)).toBe(-1);
  });

  it('avanza dentro del diálogo', () => {
    expect(trap(0, 3, false)).toBe(1);
    expect(trap(1, 3, false)).toBe(2);
  });

  it('Tab al final envuelve al principio', () => {
    expect(trap(2, 3, false)).toBe(0);
  });

  it('Shift+Tab al principio envuelve al final', () => {
    expect(trap(0, 3, true)).toBe(2);
    expect(trap(2, 3, true)).toBe(1);
  });

  it('si el foco estaba fuera, entra por un extremo', () => {
    expect(trap(-1, 4, false)).toBe(0);
    expect(trap(-1, 4, true)).toBe(3);
  });
});

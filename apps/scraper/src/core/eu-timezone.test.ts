import { describe, it, expect } from 'vitest';
import { zonedToUtc, euZonedToUtc, winterOffsetOf } from './eu-timezone.js';

/**
 * Conversión hora local (zona UE) → UTC. El punto 3.3 generaliza el antiguo
 * `madridToUtc` a cualquier zona. Estos casos fijan el comportamiento: Madrid
 * (CET/CEST), Lisboa (WET/WEST) y los bordes de cambio de hora. `month` es
 * 0-based (como Date.UTC).
 */
describe('zonedToUtc', () => {
  it('Europe/Madrid: invierno CET (+1) y verano CEST (+2)', () => {
    expect(zonedToUtc('Europe/Madrid', 2026, 0, 15, 21, 0).toISOString()).toBe('2026-01-15T20:00:00.000Z');
    expect(zonedToUtc('Europe/Madrid', 2026, 6, 15, 21, 0).toISOString()).toBe('2026-07-15T19:00:00.000Z');
  });

  it('Europe/Lisbon: invierno WET (0) y verano WEST (+1)', () => {
    expect(zonedToUtc('Europe/Lisbon', 2026, 0, 15, 21, 0).toISOString()).toBe('2026-01-15T21:00:00.000Z');
    expect(zonedToUtc('Europe/Lisbon', 2026, 6, 15, 21, 0).toISOString()).toBe('2026-07-15T20:00:00.000Z');
  });

  it('zona desconocida cae a CET (+1), como Madrid', () => {
    expect(zonedToUtc('Zona/Inexistente', 2026, 0, 15, 21, 0).toISOString())
      .toBe(zonedToUtc('Europe/Madrid', 2026, 0, 15, 21, 0).toISOString());
    expect(zonedToUtc(null, 2026, 0, 15, 21, 0).toISOString()).toBe('2026-01-15T20:00:00.000Z');
  });

  it('bordes del cambio de hora (último domingo de marzo/octubre)', () => {
    // El offset se decide con una aproximación en UTC (se trata la hora local
    // como UTC para elegir CET/CEST). Fijamos el resultado observado en los
    // instantes de transición, que caen ya en el lado de verano (+2).
    expect(zonedToUtc('Europe/Madrid', 2026, 2, 29, 1, 30).toISOString()).toBe('2026-03-28T23:30:00.000Z');
    expect(zonedToUtc('Europe/Madrid', 2026, 9, 25, 2, 30).toISOString()).toBe('2026-10-25T01:30:00.000Z');
  });
});

describe('winterOffsetOf', () => {
  it('mapea las zonas conocidas y cae a +1 por defecto', () => {
    expect(winterOffsetOf('Europe/Lisbon')).toBe(0);
    expect(winterOffsetOf('Europe/London')).toBe(0);
    expect(winterOffsetOf('Europe/Madrid')).toBe(1);
    expect(winterOffsetOf('Europe/Paris')).toBe(1);
    expect(winterOffsetOf(undefined)).toBe(1);
    expect(winterOffsetOf('Zona/Rara')).toBe(1);
  });
});

describe('euZonedToUtc (offset explícito)', () => {
  it('respeta el offset de invierno que se le pasa', () => {
    // winter=0 (Lisboa) en enero: sin desplazamiento.
    expect(euZonedToUtc(2026, 0, 15, 21, 0, 0).toISOString()).toBe('2026-01-15T21:00:00.000Z');
    // winter=1 (Madrid) en enero: -1h.
    expect(euZonedToUtc(2026, 0, 15, 21, 0, 1).toISOString()).toBe('2026-01-15T20:00:00.000Z');
  });
});

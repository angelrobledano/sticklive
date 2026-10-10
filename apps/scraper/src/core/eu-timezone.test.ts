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
    // La frontera se decide en hora LOCAL: el cambio de primavera es a las 02:00
    // locales, así que las 01:30 del día del cambio siguen siendo CET (#175).
    expect(zonedToUtc('Europe/Madrid', 2026, 2, 29, 1, 30).toISOString()).toBe('2026-03-29T00:30:00.000Z');
    // A las 02:30 ya es CEST.
    expect(zonedToUtc('Europe/Madrid', 2026, 2, 29, 2, 30).toISOString()).toBe('2026-03-29T00:30:00.000Z');
    // En otoño la hora 02:30 es ambigua: se elige la primera (todavía CEST)...
    expect(zonedToUtc('Europe/Madrid', 2026, 9, 25, 2, 30).toISOString()).toBe('2026-10-25T00:30:00.000Z');
    // ...y a las 03:30 ya es CET.
    expect(zonedToUtc('Europe/Madrid', 2026, 9, 25, 3, 30).toISOString()).toBe('2026-10-25T02:30:00.000Z');
  });
});

describe('zonedToUtc — cualquier zona IANA (base de datos de zonas, no tabla a mano)', () => {
  it('America/Asuncion: UTC-3 permanente desde oct-2024 (tzdata 2024b+)', () => {
    // WSG Asunción 2026: la fuente publica 13:15 locales y el match center ya
    // lo daba EN JUEGO a las 16:15 UTC. Con el UTC-4 cableado salía a las 17:15.
    expect(zonedToUtc('America/Asuncion', 2026, 9, 8, 13, 15).toISOString()).toBe('2026-10-08T16:15:00.000Z');
    expect(zonedToUtc('America/Asuncion', 2026, 6, 15, 21, 0).toISOString()).toBe('2026-07-16T00:00:00.000Z');
  });

  it('otras zonas fuera de la UE y Roma (ligas italianas en hora local)', () => {
    expect(zonedToUtc('America/Sao_Paulo', 2026, 9, 8, 20, 0).toISOString()).toBe('2026-10-08T23:00:00.000Z');
    expect(zonedToUtc('Asia/Tokyo', 2026, 0, 15, 9, 0).toISOString()).toBe('2026-01-15T00:00:00.000Z');
    expect(zonedToUtc('Europe/Rome', 2026, 6, 15, 21, 0).toISOString()).toBe('2026-07-15T19:00:00.000Z');
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

import { describe, it, expect } from 'vitest';
import { parseShortDatetime } from './match-datetime.js';

describe('parseShortDatetime', () => {
  it('temporada normal: el año en curso', () => {
    const now = new Date('2026-09-27T16:00:00Z');
    // "26/09 19:30" local Madrid (CEST, +2) → 17:30Z
    expect(parseShortDatetime('26/09 19:30', now)!.toISOString()).toBe('2026-09-26T17:30:00.000Z');
  });

  it('#167 entre Navidad y Año Nuevo: "02/01" es del año que entra', () => {
    const now = new Date('2026-12-30T10:00:00Z');
    // Enero es CET (+1) → 12:00 local = 11:00Z
    expect(parseShortDatetime('02/01 12:00', now)!.toISOString()).toBe('2027-01-02T11:00:00.000Z');
  });

  it('#167 principios de enero: "30/12" es del año que acaba de terminar', () => {
    const now = new Date('2027-01-02T10:00:00Z');
    expect(parseShortDatetime('30/12 12:00', now)!.toISOString()).toBe('2026-12-30T11:00:00.000Z');
  });

  it('texto inválido o vacío → undefined', () => {
    expect(parseShortDatetime('')).toBeUndefined();
    expect(parseShortDatetime(null)).toBeUndefined();
    expect(parseShortDatetime('sin fecha')).toBeUndefined();
  });
});

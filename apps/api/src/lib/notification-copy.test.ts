import { describe, it, expect } from 'vitest';
import { isQuietHours } from './notification-copy.js';

/** Silencio nocturno: 23:00–08:00 hora de Madrid. Fechas con offset explícito
 *  (+01:00 invierno) para no depender de la TZ de la máquina. */
describe('isQuietHours (Europe/Madrid)', () => {
  it('dentro del silencio: 23:00 y madrugada', () => {
    expect(isQuietHours(new Date('2026-01-15T23:00:00+01:00'))).toBe(true);
    expect(isQuietHours(new Date('2026-01-15T03:00:00+01:00'))).toBe(true);
    expect(isQuietHours(new Date('2026-01-15T07:59:00+01:00'))).toBe(true);
  });
  it('fuera del silencio: día', () => {
    expect(isQuietHours(new Date('2026-01-15T08:00:00+01:00'))).toBe(false);
    expect(isQuietHours(new Date('2026-01-15T12:00:00+01:00'))).toBe(false);
    expect(isQuietHours(new Date('2026-01-15T22:59:00+01:00'))).toBe(false);
  });
  it('respeta el horario de verano (+02:00): 23:30 CEST sigue siendo silencio', () => {
    expect(isQuietHours(new Date('2026-07-15T23:30:00+02:00'))).toBe(true);
    expect(isQuietHours(new Date('2026-07-15T12:00:00+02:00'))).toBe(false);
  });
});

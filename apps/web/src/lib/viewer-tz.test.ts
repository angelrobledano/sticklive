import { describe, it, expect } from 'vitest';
import { dateKeyIn, todayKeyIn, isValidTimeZone, localTimeDiffers } from './viewer-tz-core';

/**
 * Hora de quien mira (decisión 25/10/2026): cada usuario ve los partidos a SU
 * hora. Un PT de 3ª División a las 14:00 UTC del 24/10 es 16:00 en Madrid y
 * 15:00 en Lisboa.
 */
describe('dateKeyIn', () => {
  it('agrupa por el día de la zona dada', () => {
    // 23:30 UTC del 24/10 → 25/10 en Madrid (UTC+2) pero 24/10 en Lisboa (UTC+1... 00:30) — usa una hora clara
    expect(dateKeyIn('2026-10-24T22:30:00Z', 'Europe/Madrid')).toBe('2026-10-25');
    expect(dateKeyIn('2026-10-24T22:30:00Z', 'Europe/Lisbon')).toBe('2026-10-24');
  });
  it('vacío o inválido → cadena vacía', () => {
    expect(dateKeyIn(null, 'Europe/Madrid')).toBe('');
    expect(dateKeyIn('nope', 'Europe/Madrid')).toBe('');
  });
});

describe('todayKeyIn', () => {
  it('hoy en la zona dada', () => {
    const now = new Date('2026-10-24T23:30:00Z');
    expect(todayKeyIn('Europe/Madrid', now)).toBe('2026-10-25');
    expect(todayKeyIn('Atlantic/Azores', now)).toBe('2026-10-24');
  });
});

describe('isValidTimeZone', () => {
  it('acepta IANA y rechaza basura', () => {
    expect(isValidTimeZone('Europe/Lisbon')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone(undefined)).toBe(false);
  });
});

describe('localTimeDiffers', () => {
  it('true si la hora del pabellón no es la de quien mira', () => {
    expect(localTimeDiffers('2026-10-24T14:00:00Z', 'Europe/Madrid', 'Europe/Lisbon')).toBe(true);
    expect(localTimeDiffers('2026-10-24T14:00:00Z', 'Europe/Madrid', 'Europe/Rome')).toBe(false);
    expect(localTimeDiffers('2026-10-24T14:00:00Z', 'Europe/Madrid', null)).toBe(false);
  });
});

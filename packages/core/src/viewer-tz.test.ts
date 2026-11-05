import { describe, it, expect } from 'vitest';
import { DEFAULT_TZ, dateKeyIn, todayKeyIn, isValidTimeZone, localTimeDiffers, formatTimeIn, deviceTimeZone } from './viewer-tz';

// Origen web (apps/web/src/lib/viewer-tz.test.ts)
/**
 * Hora de quien mira (decisión 25/10/2026): cada usuario ve los partidos a SU
 * hora. Un PT de 3ª División a las 14:00 UTC del 24/10 es 16:00 en Madrid y
 * 15:00 en Lisboa.
 */
describe('viewer-tz (origen web)', () => {
  describe('dateKeyIn', () => {
    it('agrupa por el día de la zona dada', () => {
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
});

// Origen app (apps/mobile/src/lib/viewer-tz.test.ts)
describe('viewer-tz (origen app)', () => {
  it('valida nombres de zona horaria IANA', () => {
    expect(isValidTimeZone('Europe/Madrid')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Invalido/Zona')).toBe(false);
    expect(isValidTimeZone(null)).toBe(false);
  });

  it('todayKeyIn devuelve fecha actual en formato YYYY-MM-DD', () => {
    expect(todayKeyIn('UTC', new Date('2026-10-25T12:00:00Z'))).toBe('2026-10-25');
  });

  it('formatea clave de fecha según zona', () => {
    // 2026-10-25 23:30 UTC es 2026-10-26 en Madrid (UTC+1 en invierno)
    const iso = '2026-10-25T23:30:00Z';
    expect(dateKeyIn(iso, 'Europe/Madrid')).toBe('2026-10-26');
    expect(dateKeyIn(iso, 'UTC')).toBe('2026-10-25');
  });

  it('formatea HH:MM según zona', () => {
    const iso = '2026-10-25T18:00:00Z';
    expect(formatTimeIn(iso, 'UTC')).toBe('18:00');
    expect(formatTimeIn(iso, 'Europe/Madrid')).toBe('19:00');
    expect(formatTimeIn(iso, 'Europe/Lisbon')).toBe('18:00');
  });

  it('detecta diferencia con la hora local del pabellón', () => {
    const iso = '2026-10-25T18:00:00Z';
    expect(localTimeDiffers(iso, 'Europe/Madrid', 'Europe/Lisbon')).toBe(true);
    expect(localTimeDiffers(iso, 'Europe/Madrid', 'Europe/Madrid')).toBe(false);
    expect(localTimeDiffers(iso, 'Europe/Madrid', null)).toBe(false);
  });
});

describe('viewer-tz (defaults y casos añadidos al fusionar)', () => {
  it('dateKeyIn y todayKeyIn usan Europe/Madrid por defecto', () => {
    expect(DEFAULT_TZ).toBe('Europe/Madrid');
    // El core corre con TZ=UTC: si el default fuera la zona del runtime daría 2026-10-24
    expect(dateKeyIn('2026-10-24T22:30:00Z')).toBe('2026-10-25');
    expect(todayKeyIn(undefined, new Date('2026-10-24T22:30:00Z'))).toBe('2026-10-25');
  });

  it('formatTimeIn usa Europe/Madrid por defecto y devuelve vacío si no hay instante válido', () => {
    expect(formatTimeIn('2026-10-25T18:00:00Z')).toBe('19:00');
    expect(formatTimeIn(null)).toBe('');
    expect(formatTimeIn(undefined, 'UTC')).toBe('');
    expect(formatTimeIn('nope', 'UTC')).toBe('');
  });

  it('localTimeDiffers acepta iso undefined', () => {
    expect(localTimeDiffers(undefined, 'Europe/Madrid', 'Europe/Lisbon')).toBe(false);
  });

  it('deviceTimeZone devuelve una zona válida', () => {
    expect(isValidTimeZone(deviceTimeZone())).toBe(true);
  });
});

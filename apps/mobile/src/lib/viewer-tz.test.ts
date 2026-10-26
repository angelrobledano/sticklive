import { describe, it, expect } from 'vitest';
import {
  isValidTimeZone,
  dateKeyIn,
  todayKeyIn,
  formatTimeIn,
  localTimeDiffers,
} from './viewer-tz';

describe('viewer-tz', () => {
  it('valida nombres de zona horaria IANA', () => {
    expect(isValidTimeZone('Europe/Madrid')).toBe(true);
    expect(isValidTimeZone('Europe/Lisbon')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Invalido/Zona')).toBe(false);
    expect(isValidTimeZone(null)).toBe(false);
  });

  it('todayKeyIn devuelve fecha actual en formato YYYY-MM-DD', () => {
    const fixed = new Date('2026-10-25T12:00:00Z');
    expect(todayKeyIn('UTC', fixed)).toBe('2026-10-25');
  });

  it('formatea clave de fecha según zona', () => {
    // 2026-10-25 23:30 UTC es 2026-10-26 en Madrid (UTC+1 en invierno)
    const iso = '2026-10-25T23:30:00Z';
    expect(dateKeyIn(iso, 'Europe/Madrid')).toBe('2026-10-26');
    expect(dateKeyIn(iso, 'UTC')).toBe('2026-10-25');
  });

  it('formatea HH:MM según zona', () => {
    const iso = '2026-10-25T18:00:00Z';
    // En UTC es 18:00, en Madrid (invierno UTC+1) es 19:00, en Lisboa (invierno UTC+0) es 18:00
    expect(formatTimeIn(iso, 'UTC')).toBe('18:00');
    expect(formatTimeIn(iso, 'Europe/Madrid')).toBe('19:00');
    expect(formatTimeIn(iso, 'Europe/Lisbon')).toBe('18:00');
  });

  it('detecta diferencia con la hora local del pabellón', () => {
    const iso = '2026-10-25T18:00:00Z';
    // Espectador en Madrid mirando partido en Lisboa
    expect(localTimeDiffers(iso, 'Europe/Madrid', 'Europe/Lisbon')).toBe(true);
    // Espectador en Madrid mirando partido en Madrid
    expect(localTimeDiffers(iso, 'Europe/Madrid', 'Europe/Madrid')).toBe(false);
    // Pabellón sin zona o inválida
    expect(localTimeDiffers(iso, 'Europe/Madrid', null)).toBe(false);
  });
});

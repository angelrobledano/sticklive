import { describe, it, expect } from 'vitest';
import { formatDate, formatTime } from './format';

/**
 * #170: la ficha de partido formateaba la fecha/hora con 'es-ES' fijo. Ahora el
 * idioma activo se propaga desde `useT()`, así que un usuario en inglés no ve
 * abreviaturas en español.
 */
const ISO = '2026-09-28T18:30:00Z';

describe('formatDate/formatTime con locale (#170)', () => {
  it('sin locale se mantiene el español (compatibilidad)', () => {
    expect(formatDate(ISO, 'Europe/Madrid')).toMatch(/lun/i);
  });

  it('la fecha usa el idioma activo', () => {
    expect(formatDate(ISO, 'Europe/Madrid', 'es')).toMatch(/lun/i);
    expect(formatDate(ISO, 'Europe/Madrid', 'en')).toMatch(/mon/i);
    expect(formatDate(ISO, 'Europe/Madrid', 'fr')).toMatch(/lun/i);
  });

  it('la hora se formatea en la zona de la competición', () => {
    // 18:30 UTC = 20:30 en Madrid (horario de verano).
    expect(formatTime(ISO, 'Europe/Madrid')).toBe('20:30');
  });

  it('siempre 24h, también en locale en (#413: salía "08:30 PM")', () => {
    expect(formatTime(ISO, 'Europe/Madrid', 'en')).toBe('20:30');
    expect(formatTime(ISO, 'Europe/Madrid', 'fr')).toBe('20:30');
  });

  it('sin fecha devuelve el marcador por defecto', () => {
    expect(formatTime(null)).toBe('--:--');
    expect(formatDate(null)).toBe('');
  });
});

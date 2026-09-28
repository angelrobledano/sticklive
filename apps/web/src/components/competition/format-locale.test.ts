import { describe, it, expect } from 'vitest';
import { fmtDate, fmtTime, dayPillLabel } from './format';

/**
 * #170: las fechas/horas de la ficha de competición usaban 'es-ES' fijo. El
 * idioma activo debe propagarse para no mostrar abreviaturas en español a un
 * usuario en inglés, francés o italiano.
 */
const ISO = '2026-09-28T18:30:00Z';

describe('fmtDate/fmtTime/dayPillLabel con locale (#170)', () => {
  it('sin locale se mantiene el español (compatibilidad)', () => {
    expect(fmtDate(ISO, 'Europe/Madrid')).toMatch(/lun/i);
    expect(dayPillLabel('2026-09-28')).toMatch(/lun/i);
  });

  it('la fecha corta usa el idioma activo', () => {
    expect(fmtDate(ISO, 'Europe/Madrid', 'es')).toMatch(/lun/i);
    expect(fmtDate(ISO, 'Europe/Madrid', 'en')).toMatch(/mon/i);
  });

  it('la pastilla de día usa el idioma activo', () => {
    expect(dayPillLabel('2026-09-28', 'es')).toMatch(/^Lun/);
    expect(dayPillLabel('2026-09-28', 'en')).toMatch(/^Mon/);
  });

  it('la hora se formatea en la zona de la competición', () => {
    expect(fmtTime(ISO, 'Europe/Madrid')).toBe('20:30');
  });
});

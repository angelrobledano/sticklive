import { describe, it, expect } from 'vitest';
import {
  isQuietHours, isMorningHours, madridDateKey, morningSummary, morningSummaryTag,
  type MorningResult,
} from './notification-copy.js';

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

describe('isMorningHours (Europe/Madrid)', () => {
  it('envía de 08:00 a 11:59', () => {
    expect(isMorningHours(new Date('2026-01-15T08:00:00+01:00'))).toBe(true);
    expect(isMorningHours(new Date('2026-01-15T11:59:00+01:00'))).toBe(true);
  });
  it('no envía ni antes de las 08:00 ni a mediodía o por la tarde', () => {
    expect(isMorningHours(new Date('2026-01-15T07:59:00+01:00'))).toBe(false);
    expect(isMorningHours(new Date('2026-01-15T12:00:00+01:00'))).toBe(false);
    expect(isMorningHours(new Date('2026-01-15T18:00:00+01:00'))).toBe(false);
  });
});

describe('madridDateKey (Europe/Madrid)', () => {
  it('usa la fecha local de Madrid, no la de UTC', () => {
    // 22:30 UTC del 28 es ya el 29 a las 00:30 en Madrid (CEST, +02:00).
    expect(madridDateKey(new Date('2026-09-28T22:30:00Z'))).toBe('2026-09-29');
    // 12:00 UTC del 28 sigue siendo el 28 en Madrid.
    expect(madridDateKey(new Date('2026-09-28T12:00:00Z'))).toBe('2026-09-28');
  });
});

describe('morningSummary — resumen matinal agrupado', () => {
  const one: MorningResult = {
    homeShort: 'BAR', awayShort: 'IHC', homeScore: 3, awayScore: 1, kickoffLocal: '22:30',
  };

  it('con un partido', () => {
    expect(morningSummary([one])).toBe('Buenos días. Anoche: BAR 3-1 IHC (22:30).');
  });

  it('con varios partidos los agrupa en UN solo mensaje', () => {
    const two: MorningResult = {
      homeShort: 'LIC', awayShort: 'OLI', homeScore: 2, awayScore: 2, kickoffLocal: '21:00',
    };
    expect(morningSummary([one, two])).toBe(
      'Buenos días. Anoche: BAR 3-1 IHC (22:30) · LIC 2-2 OLI (21:00).'
    );
  });

  it('sin partidos devuelve un texto de respaldo (no rompe)', () => {
    expect(morningSummary([])).toContain('Buenos días');
  });
});

describe('morningSummaryTag', () => {
  it('es estable por día para que el push REEMPLACE en vez de apilar', () => {
    expect(morningSummaryTag('2026-09-29')).toBe('morning-2026-09-29');
  });
});

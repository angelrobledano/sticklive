import { describe, it, expect } from 'vitest';
import {
  isWseSeasonWindowOpen, partitionWseSeasons, isDormantReportDue,
} from './wse-season-window.js';

/**
 * #294: sidgad retira la página del calendario de una edición de World Skate
 * poco después de terminar el torneo. Sin esta decisión, el scraper insiste
 * cada 5 min contra una URL que devuelve 404 (14 días de 404 silenciosos).
 */
describe('isWseSeasonWindowOpen', () => {
  it('está abierta durante el torneo', () => {
    expect(isWseSeasonWindowOpen(new Date('2026-07-22T12:00:00Z'), '2026-07-25', 3)).toBe(true);
  });

  it('sigue abierta dentro del margen de gracia tras el cierre', () => {
    expect(isWseSeasonWindowOpen(new Date('2026-07-28T12:00:00Z'), '2026-07-25', 3)).toBe(true);
  });

  it('se cierra cuando el margen de gracia ya ha pasado', () => {
    // Torneo U17 2026 terminado el 25/07; a 28/09 la ventana lleva cerrada meses.
    expect(isWseSeasonWindowOpen(new Date('2026-09-28T12:00:00Z'), '2026-07-25', 3)).toBe(false);
  });

  it('incluye el propio día límite (fin + gracia)', () => {
    expect(isWseSeasonWindowOpen(new Date('2026-07-28T23:59:59Z'), '2026-07-25', 3)).toBe(true);
    expect(isWseSeasonWindowOpen(new Date('2026-07-29T00:00:01Z'), '2026-07-25', 3)).toBe(false);
  });

  it('sin fecha de fin, la ventana no se cierra (compatibilidad)', () => {
    expect(isWseSeasonWindowOpen(new Date('2030-01-01T00:00:00Z'), null, 3)).toBe(true);
    expect(isWseSeasonWindowOpen(new Date('2030-01-01T00:00:00Z'), undefined, 3)).toBe(true);
  });

  it('acepta un Date además de una cadena ISO', () => {
    expect(isWseSeasonWindowOpen(new Date('2026-07-22T12:00:00Z'), new Date('2026-07-25T00:00:00Z'), 3)).toBe(true);
  });

  it('con gracia 0 se cierra justo al acabar el último día', () => {
    expect(isWseSeasonWindowOpen(new Date('2026-07-25T12:00:00Z'), '2026-07-25', 0)).toBe(true);
    expect(isWseSeasonWindowOpen(new Date('2026-07-26T12:00:00Z'), '2026-07-25', 0)).toBe(false);
  });
});

describe('partitionWseSeasons', () => {
  const seasons = [
    { idc: '320', name: 'Europeo Sub-17 M', endDate: '2026-07-25' },
    { idc: '321', name: 'Europeo Sub-17 F', endDate: '2026-07-25' },
    { idc: '400', name: 'Europeo absoluto', endDate: '2027-01-10' },
  ];

  it('separa las ediciones terminadas de las activas conservando el orden', () => {
    const { active, dormant } = partitionWseSeasons(new Date('2026-09-28T00:00:00Z'), seasons, 3);
    expect(dormant.map((s) => s.idc)).toEqual(['320', '321']);
    expect(active.map((s) => s.idc)).toEqual(['400']);
  });

  it('durante el torneo no hay ninguna dormida', () => {
    const { active, dormant } = partitionWseSeasons(new Date('2026-07-22T00:00:00Z'), seasons, 3);
    expect(dormant).toEqual([]);
    expect(active).toHaveLength(3);
  });

  it('una lista vacía no produce nada', () => {
    expect(partitionWseSeasons(new Date(), [], 3)).toEqual({ active: [], dormant: [] });
  });
});

describe('isDormantReportDue', () => {
  const NOW = new Date('2026-09-28T12:00:00Z');
  const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

  it('sin registro previo, toca avisar', () => {
    expect(isDormantReportDue(null, NOW, 24)).toBe(true);
  });

  it('si el último run no fue un "skipped", es la primera detección: avisa', () => {
    expect(isDormantReportDue({ status: 'success', scrapedAt: hoursAgo(1) }, NOW, 24)).toBe(true);
  });

  it('si ya se avisó hace poco, NO repite', () => {
    expect(isDormantReportDue({ status: 'skipped', scrapedAt: hoursAgo(1) }, NOW, 24)).toBe(false);
  });

  it('pasado el intervalo, vuelve a avisar', () => {
    expect(isDormantReportDue({ status: 'skipped', scrapedAt: hoursAgo(30) }, NOW, 24)).toBe(true);
  });

  it('acepta la fecha como string ISO', () => {
    expect(isDormantReportDue({ status: 'skipped', scrapedAt: '2026-09-28T06:00:00Z' }, NOW, 24)).toBe(false);
  });
});

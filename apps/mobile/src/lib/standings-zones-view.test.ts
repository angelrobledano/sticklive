import { describe, it, expect } from 'vitest';
import { rowZones, zoneLegend, zoneChangesAfter, type ZoneRow } from './standings-zones-view';

const filas = (n: number, zones: Record<number, ZoneRow['zone']> = {}): ZoneRow[] =>
  Array.from({ length: n }, (_, i) => ({ position: i + 1, zone: zones[i + 1] ?? null }));

describe('rowZones', () => {
  it('con zonas declaradas usa las de la API, aunque no coincidan con 8/2', () => {
    const rows = filas(12, {
      1: { kind: 'champion', target: null },
      2: { kind: 'promotion_playoff', target: 'OK Liga' },
      12: { kind: 'relegation', target: 'Primera Catalana' },
    });
    expect(rowZones(rows, { legacyFallback: true }).map((z) => z?.kind ?? null)).toEqual([
      'champion',
      'promotion_playoff',
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      'relegation',
    ]);
  });

  it('sin ninguna zona declarada mantiene el 8/2 de antes en ligas de más de 8', () => {
    const z = rowZones(filas(16), { legacyFallback: true }).map((x) => x?.kind ?? null);
    expect(z.slice(0, 8).every((k) => k === 'promotion_playoff')).toBe(true);
    expect(z.slice(8, 14).every((k) => k === null)).toBe(true);
    expect(z.slice(14)).toEqual(['relegation', 'relegation']);
  });

  it('sin zonas y con 8 equipos o menos (o en grupos), nada', () => {
    expect(rowZones(filas(6), { legacyFallback: true }).every((z) => z === null)).toBe(true);
    expect(rowZones(filas(16), { legacyFallback: false }).every((z) => z === null)).toBe(true);
  });
});

describe('zoneChangesAfter', () => {
  it('marca la línea de corte donde cambia la zona, no al final de la tabla', () => {
    const zones = rowZones(
      filas(4, {
        1: { kind: 'promotion', target: null },
        2: { kind: 'promotion', target: null },
        4: { kind: 'relegation', target: null },
      }),
      { legacyFallback: false },
    );
    expect(zoneChangesAfter(zones)).toEqual([false, true, true, false]);
  });
});

describe('zoneLegend', () => {
  it('una entrada por zona y destino, en el orden de la tabla', () => {
    const zones = rowZones(
      filas(5, {
        1: { kind: 'champion', target: null },
        2: { kind: 'promotion_playoff', target: 'OK Liga' },
        3: { kind: 'promotion_playoff', target: 'OK Liga' },
        5: { kind: 'relegation', target: 'Primera' },
      }),
      { legacyFallback: false },
    );
    expect(zoneLegend(zones)).toEqual([
      { kind: 'champion', target: null },
      { kind: 'promotion_playoff', target: 'OK Liga' },
      { kind: 'relegation', target: 'Primera' },
    ]);
  });
});

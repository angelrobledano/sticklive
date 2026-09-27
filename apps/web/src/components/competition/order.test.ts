import { describe, it, expect } from 'vitest';
import { hasSeason2026, importanceRank, orderByImportance } from './order';
import type { CompetitionSummary } from '@/lib/api/client';

function comp(slug: string, over: Partial<CompetitionSummary> = {}): CompetitionSummary {
  return {
    id: slug,
    name: slug,
    shortName: null,
    slug,
    gender: null,
    category: null,
    country: 'ES',
    organizer: 'RFEP',
    scope: 'national',
    region: null,
    ageCategory: 'senior',
    season: { id: 's-1', name: '2026/27', isCurrent: true, teamCount: 0, matchCount: 0 },
    ...over,
  };
}

describe('hasSeason2026', () => {
  it('muestra solo las que tienen la temporada 2026/27', () => {
    expect(hasSeason2026(comp('ok-liga-masculina'))).toBe(true);
  });

  it('oculta las que no la tienen, aunque su temporada sea la actual', () => {
    // Este es el caso que importa: is_current=TRUE de 2025/26 NO debe mostrarla.
    const c = comp('ok-liga-bronce-eliminatoria', {
      season: { id: 's-2', name: '2025/26', isCurrent: true, teamCount: 0, matchCount: 0 },
    });
    expect(hasSeason2026(c)).toBe(false);
  });

  it('sin temporada no se muestra', () => {
    expect(hasSeason2026(comp('x', { season: null }))).toBe(false);
  });

  it('la temporada histórica colapsada no se muestra', () => {
    const c = comp('copa-del-rey', {
      season: { id: 's-3', name: 'Histórico', isCurrent: false, teamCount: 0, matchCount: 0 },
    });
    expect(hasSeason2026(c)).toBe(false);
  });

  it('si el nombre no trae el año, se usa la fecha de inicio', () => {
    const c = comp('ok-liga-plata-norte', {
      season: { id: 's-4', name: null, startDate: '2026-09-01', isCurrent: false, teamCount: 0, matchCount: 0 },
    });
    expect(hasSeason2026(c)).toBe(true);
  });
});

describe('importanceRank', () => {
  it('ordena según la lista de producto', () => {
    expect(importanceRank(comp('ok-liga-masculina'))).toBe(1);
    expect(importanceRank(comp('ok-liga-femenina'))).toBe(2);
    expect(importanceRank(comp('copa-del-rey'))).toBe(3);
    expect(importanceRank(comp('copa-de-la-reina-iberdrola'))).toBe(4);
    expect(importanceRank(comp('supercopa-de-espana-masculina'))).toBe(5);
    expect(importanceRank(comp('supercopa-de-espana-femenina'))).toBe(6);
    expect(importanceRank(comp('ok-liga-plata-norte'))).toBe(7);
    expect(importanceRank(comp('ok-liga-plata-sur'))).toBe(8);
    expect(importanceRank(comp('ok-liga-plata-femenina'))).toBe(9);
    expect(importanceRank(comp('copa-sar-la-princesa-masculina'))).toBe(10);
    expect(importanceRank(comp('copa-sar-la-princesa-femenina'))).toBe(11);
    expect(importanceRank(comp('ok-liga-bronce-masculina-norte'))).toBe(12);
    expect(importanceRank(comp('ok-liga-bronce-masculina-sur'))).toBe(13);
    expect(importanceRank(comp('ok-liga-plata-masculina-eliminatoria'))).toBe(14);
    expect(importanceRank(comp('ok-liga-bronce-eliminatoria'))).toBe(15);
  });

  it('lo no listado queda por detrás de la lista', () => {
    expect(importanceRank(comp('torneo-desconocido'))).toBeGreaterThan(15);
  });
});

describe('orderByImportance', () => {
  it('ordena de mayor a menor importancia, con lo no listado al final', () => {
    const entrada = [
      comp('ok-liga-bronce-masculina-sur'),
      comp('supercopa-de-espana-masculina'),
      comp('ok-liga-femenina'),
      comp('torneo-desconocido'),
      comp('ok-liga-masculina'),
    ];
    const salida = orderByImportance(entrada, 'es').map((c) => c.slug);
    expect(salida).toEqual([
      'ok-liga-masculina',
      'ok-liga-femenina',
      'supercopa-de-espana-masculina',
      'ok-liga-bronce-masculina-sur',
      'torneo-desconocido',
    ]);
  });

  it('no muta la lista original', () => {
    const entrada = [comp('ok-liga-bronce-masculina-sur'), comp('ok-liga-masculina')];
    const copia = [...entrada];
    orderByImportance(entrada, 'es');
    expect(entrada).toEqual(copia);
  });
});

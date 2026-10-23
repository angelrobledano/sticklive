import { describe, it, expect } from 'vitest';
import { currentSeasonYear, hasSeasonYear, importanceRank, orderByImportance } from './competition-importance';
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

describe('currentSeasonYear', () => {
  it('deriva el año de la temporada más reciente del listado', () => {
    expect(currentSeasonYear([
      comp('a'), // 2026/27
      comp('b', { season: { id: 's', name: '2025/26', isCurrent: true, teamCount: 0, matchCount: 0 } }),
    ])).toBe(2026);
  });

  it('ignora «Histórico», los sin temporada y toma el máximo', () => {
    expect(currentSeasonYear([
      comp('a', { season: null }),
      comp('b', { season: { id: 's', name: 'Histórico', isCurrent: false, teamCount: 0, matchCount: 0 } }),
      comp('c', { season: { id: 's', name: '2027/28', isCurrent: true, teamCount: 0, matchCount: 0 } }),
    ])).toBe(2027);
  });

  it('sin datos devuelve null', () => {
    expect(currentSeasonYear([])).toBeNull();
  });
});

describe('hasSeasonYear', () => {
  it('muestra solo las que incluyen el año vigente', () => {
    expect(hasSeasonYear(comp('ok-liga-masculina'), 2026)).toBe(true);
  });

  it('oculta las que no lo tienen, aunque su temporada sea la actual', () => {
    const c = comp('ok-liga-bronce-eliminatoria', {
      season: { id: 's-2', name: '2025/26', isCurrent: true, teamCount: 0, matchCount: 0 },
    });
    expect(hasSeasonYear(c, 2026)).toBe(false);
  });

  it('sin temporada no se muestra', () => {
    expect(hasSeasonYear(comp('x', { season: null }), 2026)).toBe(false);
  });

  it('la temporada histórica colapsada no se muestra', () => {
    const c = comp('copa-del-rey', {
      season: { id: 's-3', name: 'Histórico', isCurrent: false, teamCount: 0, matchCount: 0 },
    });
    expect(hasSeasonYear(c, 2026)).toBe(false);
  });

  it('una temporada 2025/26 jugada en 2026 NO se muestra (regla estricta por nombre)', () => {
    // Caso real: el Europeo Sub-17 de World Skate tiene temporada "2025/26"
    // pero se jugó en julio de 2026 → un respaldo por fecha lo colaba.
    const c = comp('campeonato-de-europa-sub-17-masculino', {
      season: { id: 's-4', name: '2025/26', startDate: '2026-07-20', isCurrent: true, teamCount: 8, matchCount: 12 },
    });
    expect(hasSeasonYear(c, 2026)).toBe(false);
  });

  it('en 2027 la portada sigue funcionando porque el año se deriva del listado (#172)', () => {
    const comps = [comp('a', { season: { id: 's', name: '2027/28', isCurrent: true, teamCount: 0, matchCount: 0 } })];
    const year = currentSeasonYear(comps)!;
    expect(year).toBe(2027);
    expect(hasSeasonYear(comps[0]!, year)).toBe(true);
  });
});

describe('importanceRank (datos, migración 089)', () => {
  it('featuredRank manda; luego tier; sin datos al final', () => {
    expect(importanceRank({ featuredRank: 1, tier: 1 })).toBe(1);
    expect(importanceRank({ featuredRank: 7 })).toBe(7);
    expect(importanceRank({ featuredRank: null, tier: 1 })).toBe(510);
    expect(importanceRank({ tier: 2 })).toBe(520);
    expect(importanceRank({ slug: 'ok-liga-masculina' })).toBe(1000);
    expect(importanceRank(null)).toBe(1000);
  });

  it('cualquier destacada va antes que cualquier tier', () => {
    expect(importanceRank({ featuredRank: 99 })).toBeLessThan(importanceRank({ tier: 1 }));
  });
});

describe('orderByImportance', () => {
  it('ordena competiciones de mayor a menor importancia, con lo no clasificado al final', () => {
    const entrada = [
      comp('ok-liga-bronce-masculina-sur', { tier: 3 }),
      comp('supercopa-de-espana-masculina', { featuredRank: 9, tier: 1 }),
      comp('ok-liga-femenina', { featuredRank: 6, tier: 1 }),
      comp('torneo-desconocido'),
      comp('ok-liga-masculina', { featuredRank: 5, tier: 1 }),
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

  it('ordena los bloques del día (grupos { name, featuredRank, tier })', () => {
    const grupos = [
      { name: 'OK Liga Bronce Masculina Sur', tier: 3, featuredRank: null, matches: ['a'] },
      { name: 'OK Liga Masculina', tier: 1, featuredRank: 5, matches: ['b'] },
      { name: 'Otras competiciones', tier: null, featuredRank: null, matches: ['c'] },
      { name: 'OK Liga Plata Norte', tier: 2, featuredRank: null, matches: ['d'] },
    ];
    const salida = orderByImportance(grupos, 'es').map((g) => g.name);
    expect(salida).toEqual([
      'OK Liga Masculina',
      'OK Liga Plata Norte',
      'OK Liga Bronce Masculina Sur',
      'Otras competiciones',
    ]);
  });

  it('no muta la lista original', () => {
    const entrada = [comp('ok-liga-bronce-masculina-sur'), comp('ok-liga-masculina')];
    const copia = [...entrada];
    orderByImportance(entrada, 'es');
    expect(entrada).toEqual(copia);
  });
});

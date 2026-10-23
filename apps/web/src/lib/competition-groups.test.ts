import { describe, it, expect } from 'vitest';
import type { CompetitionSummary, Federation, FederationRef } from '@/lib/api/client';
import {
  buildCompetitionTree, competitionsUnderFederation, featuredCompetitions,
  filterByGender, isCup,
} from './competition-groups';
import { importanceRank } from './competition-importance';

const FED: Record<string, Federation> = {
  WS:   { code: 'World Skate', slug: 'world-skate', name: 'World Skate', shortName: 'World Skate', level: 'world', parentCode: null, country: null, region: null, website: null, displayOrder: 1, competitionCount: 0 },
  WSE:  { code: 'WSE', slug: 'wse', name: 'World Skate Europe', shortName: 'WSE', level: 'continental', parentCode: 'World Skate', country: null, region: null, website: null, displayOrder: 2, competitionCount: 0 },
  RFEP: { code: 'RFEP', slug: 'rfep', name: 'RFEP', shortName: 'RFEP', level: 'national', parentCode: 'WSE', country: 'ES', region: null, website: null, displayOrder: 10, competitionCount: 0 },
  FPP:  { code: 'FPP', slug: 'fpp', name: 'FPP', shortName: 'FPP', level: 'national', parentCode: 'WSE', country: 'PT', region: null, website: null, displayOrder: 20, competitionCount: 0 },
  FMP:  { code: 'FMP', slug: 'fmp', name: 'FMP', shortName: 'FMP', level: 'regional', parentCode: 'RFEP', country: 'ES', region: 'Madrid', website: null, displayOrder: 140, competitionCount: 0 },
  FECAPA: { code: 'FECAPA', slug: 'fecapa', name: 'FECAPA', shortName: 'FECAPA', level: 'regional', parentCode: 'RFEP', country: 'ES', region: 'Cataluña', website: null, displayOrder: 110, competitionCount: 0 },
};
const FEDS = Object.values(FED);
const ref = (f: Federation): FederationRef => f;

function comp(slug: string, over: Partial<CompetitionSummary> = {}): CompetitionSummary {
  return {
    id: slug, name: slug, shortName: null, slug, gender: 'male', category: null,
    country: 'ES', organizer: 'RFEP', scope: 'national', region: null, ageCategory: 'senior',
    tier: null, featuredRank: null, federation: ref(FED.RFEP!),
    season: { id: 's', name: '2026/27', isCurrent: true, teamCount: 0, matchCount: 0 },
    ...over,
  };
}

describe('importanceRank con datos (089)', () => {
  it('featuredRank manda, luego tier, y el mapa legado solo sin datos', () => {
    expect(importanceRank({ slug: 'x', featuredRank: 3 })).toBe(3);
    expect(importanceRank({ slug: 'x', featuredRank: null, tier: 1 })).toBe(510);
    // featuredRank null explícito (viene de la API) ignora el mapa legado
    expect(importanceRank({ slug: 'ok-liga-plata-norte', featuredRank: null, tier: 2 })).toBe(520);
    expect(importanceRank({ slug: 'ok-liga-plata-norte' })).toBe(11);
  });

  it('la 1ª de Portugal (tier 1) va antes que la OK Liga Plata (tier 2)', () => {
    const pt = comp('1-divisao', { tier: 1, federation: ref(FED.FPP!), country: 'PT' });
    const plata = comp('ok-liga-plata-norte', { tier: 2 });
    expect(importanceRank(pt)).toBeLessThan(importanceRank(plata));
  });
});

describe('isCup', () => {
  it('reconoce copas en varios idiomas', () => {
    for (const n of ['Copa del Rey', 'Supercopa de España', 'Taça de Portugal', 'Coppa Italia']) {
      expect(isCup({ name: n })).toBe(true);
    }
    expect(isCup({ name: 'OK Liga Masculina' })).toBe(false);
  });
});

describe('featuredCompetitions', () => {
  it('usa la curación en su orden', () => {
    const out = featuredCompetitions([
      comp('b', { featuredRank: 2 }), comp('a', { featuredRank: 1 }), comp('c'),
    ], 'es');
    expect(out.map((c) => c.slug)).toEqual(['a', 'b']);
  });

  it('sin curación cae a tier 1 sénior', () => {
    const out = featuredCompetitions([
      comp('top', { tier: 1 }), comp('base', { tier: 1, ageCategory: 'juvenil' }), comp('t2', { tier: 2 }),
    ], 'es');
    expect(out.map((c) => c.slug)).toEqual(['top']);
  });
});

describe('filterByGender', () => {
  it('mixtas y sin género salen en ambos filtros', () => {
    const list = [comp('m'), comp('f', { gender: 'female' }), comp('x', { gender: 'mixed' }), comp('n', { gender: null })];
    expect(filterByGender(list, 'female').map((c) => c.slug)).toEqual(['f', 'x', 'n']);
    expect(filterByGender(list, 'all')).toHaveLength(4);
  });
});

describe('buildCompetitionTree', () => {
  const comps = [
    comp('mundial', { scope: 'international', federation: ref(FED.WS!), country: 'W' }),
    comp('europeo-u17', { scope: 'national', federation: ref(FED.WSE!), country: 'EU' }),
    comp('ok-liga', { tier: 1 }),
    comp('copa-del-rey', { name: 'Copa del Rey', tier: 1 }),
    comp('juvenil', { ageCategory: 'juvenil' }),
    comp('fmp-1', { scope: 'regional', organizer: 'FMP', federation: ref(FED.FMP!) }),
    comp('fecapa-1', { scope: 'regional', organizer: 'FECAPA', federation: ref(FED.FECAPA!) }),
    comp('pt-1', { country: 'PT', organizer: 'FPP', federation: ref(FED.FPP!), tier: 1 }),
    comp('huerfana', { country: 'FR', organizer: 'FFRS', federation: null }),
  ];
  const tree = buildCompetitionTree(comps, 'es', FEDS);

  it('internacional por scope o por federación world/continental', () => {
    expect(tree.international.map((c) => c.slug).sort()).toEqual(['europeo-u17', 'mundial']);
  });

  it('países por display_order de su federación; sin federación detrás', () => {
    expect(tree.countries.map((c) => c.code)).toEqual(['ES', 'PT', 'FR']);
  });

  it('secciones del país: ligas, copas, base y autonómicas por display_order', () => {
    const es = tree.countries[0]!.sections;
    expect(es.leagues.map((c) => c.slug)).toEqual(['ok-liga']);
    expect(es.cups.map((c) => c.slug)).toEqual(['copa-del-rey']);
    expect(es.base.map((c) => c.slug)).toEqual(['juvenil']);
    expect(es.regional.map((g) => g.key)).toEqual(['FECAPA', 'FMP']);
    expect(es.regional[0]!.label).toBe('Cataluña');
  });
});

describe('competitionsUnderFederation', () => {
  it('incluye las federaciones hijas', () => {
    const comps = [
      comp('ok-liga'),
      comp('fmp-1', { federation: ref(FED.FMP!) }),
      comp('pt-1', { federation: ref(FED.FPP!) }),
    ];
    expect(competitionsUnderFederation(comps, 'RFEP', FEDS).map((c) => c.slug)).toEqual(['ok-liga', 'fmp-1']);
    expect(competitionsUnderFederation(comps, 'FMP', FEDS).map((c) => c.slug)).toEqual(['fmp-1']);
  });
});

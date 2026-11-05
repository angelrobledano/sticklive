import { describe, it, expect } from 'vitest';
import type { CompetitionSummary, Federation, FederationRef } from '@sports/core/api';
import {
  buildCompetitionTree, featuredCompetitions,
  filterByGender, isCup,
} from './competition-groups';
import { importanceRank } from '@sports/core/competition-importance';

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
    id: slug, name: slug, nameI18n: null, shortName: null, slug, gender: 'male', category: null,
    country: 'ES', organizer: 'RFEP', scope: 'national', region: null, ageCategory: 'senior',
    dataQuality: 'ok', tier: null, featuredRank: null, federation: ref(FED.RFEP!),
    season: { id: 's', name: '2026/27', startDate: null, endDate: null, isCurrent: true, teamCount: 0, matchCount: 0 },
    ...over,
  };
}

describe('competition-groups', () => {
  describe('importanceRank con datos (089)', () => {
    it('featuredRank manda y luego tier', () => {
      expect(importanceRank({ slug: 'x', featuredRank: 3 })).toBe(3);
      expect(importanceRank({ slug: 'x', featuredRank: null, tier: 1 })).toBe(510);
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
    it('separa internacional y agrupa por país con secciones', () => {
      const wse = comp('wse-champions', { scope: 'international', federation: ref(FED.WSE!) });
      const okLiga = comp('ok-liga', { tier: 1 });
      const plata = comp('ok-liga-plata', { tier: 2 });
      const copa = comp('copa-del-rey', { name: 'Copa del Rey' });
      const sub17 = comp('sub-17', { ageCategory: 'sub-17' });
      const fmp = comp('1-madrid', { scope: 'regional', region: 'Madrid', federation: ref(FED.FMP!) });

      const tree = buildCompetitionTree([wse, okLiga, plata, copa, sub17, fmp], 'es', FEDS);
      expect(tree.international.map((c) => c.slug)).toEqual(['wse-champions']);
      expect(tree.countries).toHaveLength(1);
      const es = tree.countries[0];
      expect(es.code).toBe('ES');
      expect(es.sections.mainLeagues.map((c) => c.slug)).toEqual(['ok-liga']);
      expect(es.sections.otherLeagues.map((c) => c.slug)).toEqual(['ok-liga-plata']);
      expect(es.sections.leagues.map((c) => c.slug)).toEqual(['ok-liga', 'ok-liga-plata']);
      expect(es.sections.cups.map((c) => c.slug)).toEqual(['copa-del-rey']);
      expect(es.sections.base.map((c) => c.slug)).toEqual(['sub-17']);
      expect(es.sections.regional).toHaveLength(1);
      expect(es.sections.regional[0].key).toBe('FMP');
    });
  });
});

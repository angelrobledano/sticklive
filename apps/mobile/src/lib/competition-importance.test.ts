import { describe, expect, it } from 'vitest';
import {
  currentSeasonYear,
  hasSeasonYear,
  orderByImportance,
} from './competition-importance';
import type { CompetitionSummary } from './api/types';

function createComp(name: string, slug: string, seasonName?: string): CompetitionSummary {
  return {
    id: slug,
    name,
    nameI18n: null,
    shortName: null,
    slug,
    gender: 'male',
    category: 'ok-liga',
    country: 'ES',
    organizer: 'RFEP',
    scope: 'national',
    region: null,
    ageCategory: 'senior',
    dataQuality: 'full',
    season: seasonName
      ? {
          id: `season-${slug}`,
          name: seasonName,
          startDate: null,
          endDate: null,
          isCurrent: true,
          teamCount: 14,
          matchCount: 26,
        }
      : null,
  };
}

describe('competition-importance helpers', () => {
  describe('currentSeasonYear', () => {
    it('extrae el año más alto de las temporadas vigentes', () => {
      const comps = [
        createComp('Liga 1', 'l1', '2025/26'),
        createComp('Liga 2', 'l2', '2026/27'),
        createComp('Liga 3', 'l3', 'Histórico 2030'), // ignora "Histórico"
      ];
      expect(currentSeasonYear(comps)).toBe(2026);
    });

    it('devuelve null si no hay temporadas válidas', () => {
      expect(currentSeasonYear([])).toBe(null);
    });
  });

  describe('hasSeasonYear', () => {
    it('comprueba si la temporada contiene el año indicado', () => {
      const comp = createComp('Liga 1', 'l1', '2026/27');
      expect(hasSeasonYear(comp, 2026)).toBe(true);
      expect(hasSeasonYear(comp, 2025)).toBe(false);
    });
  });

  describe('orderByImportance', () => {
    it('ordena por ranking de importancia y desempata por nombre', () => {
      const c1 = createComp('OK Liga Bronce', 'ok-liga-bronce-masculina-norte');
      const c2 = createComp('OK Liga Masculina', 'ok-liga-masculina');
      const c3 = createComp('Mundial Masculino', 'mundial-masculino-worldskate');

      const sorted = orderByImportance([c1, c2, c3], 'es');
      expect(sorted[0].slug).toBe('mundial-masculino-worldskate');
      expect(sorted[1].slug).toBe('ok-liga-masculina');
      expect(sorted[2].slug).toBe('ok-liga-bronce-masculina-norte');
    });

    it('prioriza featuredRank sobre tier y slugs sin rank', () => {
      const topCurated = { name: 'Copa Destacada', slug: 'copa-x', featuredRank: 1 };
      const tier1 = { name: 'Liga Tier 1', slug: 'tier-1', tier: 1 };
      const tier2 = { name: 'Liga Tier 2', slug: 'tier-2', tier: 2 };
      const unknown = { name: 'Desconocida', slug: 'desconocida' };

      const sorted = orderByImportance([unknown, tier2, topCurated, tier1], 'es');
      expect(sorted.map((s) => s.name)).toEqual([
        'Copa Destacada',
        'Liga Tier 1',
        'Liga Tier 2',
        'Desconocida',
      ]);
    });
  });
});

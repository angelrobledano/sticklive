import { describe, expect, it } from 'vitest';
import {
  filterCompetitions,
  genderLabel,
  groupCompetitionsForIndex,
  normalizeSearchText,
  orderSearchResults,
} from './competition-filter';
import type { CompetitionSummary } from './api/types';

function createComp(name: string, over: Partial<CompetitionSummary> = {}): CompetitionSummary {
  return {
    id: name,
    name,
    nameI18n: null,
    shortName: null,
    slug: name.toLowerCase().replace(/\s+/g, '-'),
    gender: 'male',
    category: 'ok-liga',
    country: 'ES',
    organizer: 'RFEP',
    scope: 'national',
    region: null,
    ageCategory: 'senior',
    dataQuality: 'full',
    season: { id: 's-1', name: '2026/27', isCurrent: true, teamCount: 14, matchCount: 26, startDate: null, endDate: null },
    ...over,
  };
}

const countryName = (code: string | null) => (code === 'ES' ? 'España' : code === 'PT' ? 'Portugal' : '');

describe('competition-filter helpers', () => {
  describe('normalizeSearchText', () => {
    it('pasa a minúsculas y quita acentos', () => {
      expect(normalizeSearchText('Primera División')).toBe('primera division');
      expect(normalizeSearchText('Copa del Rey')).toBe('copa del rey');
    });
  });

  describe('filterCompetitions', () => {
    it('filtra por nombre ignorando mayúsculas y acentos', () => {
      const comps = [
        createComp('Copa del Rey'),
        createComp('OK Liga Masculina'),
        createComp('Primera División'),
      ];
      expect(filterCompetitions(comps, 'copa del rey', countryName).map((c) => c.name)).toEqual(['Copa del Rey']);
      expect(filterCompetitions(comps, 'primera division', countryName).map((c) => c.name)).toEqual(['Primera División']);
    });

    it('filtra también por nombre corto, organizador o país', () => {
      const comps = [
        createComp('OK Liga', { shortName: 'OKL' }),
        createComp('Campeonato de Portugal', { country: 'PT', organizer: 'FPP' }),
      ];
      expect(filterCompetitions(comps, 'okl', countryName)).toHaveLength(1);
      expect(filterCompetitions(comps, 'portugal', countryName)).toHaveLength(1);
      expect(filterCompetitions(comps, 'fpp', countryName)).toHaveLength(1);
    });
  });

  describe('matchRelevance y orderSearchResults', () => {
    it('ubica coincidencias exactas o de prefijo primero', () => {
      const comps = [
        createComp('Supercopa de España Masculina'),
        createComp('Copa del Rey'),
        createComp('Copa SAR la Princesa'),
      ];
      const ordered = orderSearchResults(comps, 'copa', 'es');
      expect(ordered[0].name).toBe('Copa del Rey');
    });
  });

  describe('groupCompetitionsForIndex', () => {
    it('separa competiciones internacionales y agrupa por país según COUNTRY_ORDER', () => {
      const comps = [
        createComp('Mundial Masculino', { scope: 'international', country: 'W' }),
        createComp('OK Liga', { scope: 'national', country: 'ES' }),
        createComp('Campeonato Placard', { scope: 'national', country: 'PT' }),
      ];

      const { international, byCountry } = groupCompetitionsForIndex(comps, 'es');
      expect(international).toHaveLength(1);
      expect(international[0].name).toBe('Mundial Masculino');

      expect(byCountry.map(([c]) => c)).toEqual(['ES', 'PT']);
    });
  });

  describe('genderLabel', () => {
    it('traduce géneros', () => {
      const t = (k: string) => (k === 'common.male' ? 'Masculina' : 'Femenina');
      expect(genderLabel('male', t)).toBe('Masculina');
      expect(genderLabel('female', t)).toBe('Femenina');
      expect(genderLabel(null, t)).toBe('');
    });
  });
});

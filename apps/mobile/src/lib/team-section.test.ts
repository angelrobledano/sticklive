import { describe, expect, it } from 'vitest';
import {
  ageCategoryLabel,
  seasonOptionLabel,
  sectionBadgeText,
  squadLevelLetter,
  staffDisplayName,
} from './team-section';
import type { TeamSeason } from '@/src/lib/api/types';

const t = (k: string) => k;

describe('team-section helpers', () => {
  describe('squadLevelLetter', () => {
    it('returns empty string for level 1 or lower', () => {
      expect(squadLevelLetter(null)).toBe('');
      expect(squadLevelLetter(1)).toBe('');
      expect(squadLevelLetter(0)).toBe('');
    });

    it('returns letter B for level 2, C for level 3', () => {
      expect(squadLevelLetter(2)).toBe('B');
      expect(squadLevelLetter(3)).toBe('C');
    });

    it('clamps to Z for levels above 26', () => {
      expect(squadLevelLetter(30)).toBe('Z');
    });
  });

  describe('ageCategoryLabel', () => {
    it('formats sub-categories', () => {
      expect(ageCategoryLabel('sub17', t)).toBe('Sub-17');
      expect(ageCategoryLabel('u-19', t)).toBe('Sub-19');
    });

    it('uses i18n for known age categories', () => {
      expect(ageCategoryLabel('senior', t)).toBe('age_categories.senior');
      expect(ageCategoryLabel('juvenil', t)).toBe('age_categories.juvenil');
    });

    it('returns null for unknown categories', () => {
      expect(ageCategoryLabel('desconocida', t)).toBeNull();
      expect(ageCategoryLabel(null, t)).toBeNull();
    });
  });

  describe('sectionBadgeText', () => {
    it('formats gender + category + filial', () => {
      expect(sectionBadgeText({ gender: 'female', ageCategory: 'senior', squadLevel: 1 }, t))
        .toBe('common.female · age_categories.senior');
      expect(sectionBadgeText({ gender: 'male', ageCategory: 'senior', squadLevel: 2 }, t))
        .toBe('common.male · age_categories.senior · team.filial B');
    });

    it('handles empty inputs', () => {
      expect(sectionBadgeText({}, t)).toBe('');
      expect(sectionBadgeText({ gender: 'mixed', ageCategory: null, squadLevel: 1 }, t)).toBe('');
    });
  });

  describe('seasonOptionLabel', () => {
    const base: TeamSeason = {
      id: 's1',
      name: '2026/27',
      isCurrent: true,
      competitionName: 'OK Liga Masculina',
      competitionShort: 'OKL',
    };

    it('uses short competition name and marks current', () => {
      expect(seasonOptionLabel(base, (k) => (k === 'common.current' ? 'Actual' : k)))
        .toBe('OKL · 2026/27 · Actual');
    });

    it('falls back to full competition name and skips non-current', () => {
      expect(seasonOptionLabel({ ...base, competitionShort: null, isCurrent: false }, t))
        .toBe('OK Liga Masculina · 2026/27');
    });
  });

  describe('staffDisplayName', () => {
    it('converts LASTNAME LASTNAME FIRSTNAME to Firstname Lastname', () => {
      expect(staffDisplayName('ARES LOZANO RICARDO')).toBe('Ricardo Ares');
      expect(staffDisplayName('ESCUDERO RUIZ MOISES')).toBe('Moises Escudero');
    });

    it('handles single word', () => {
      expect(staffDisplayName('RICARDO')).toBe('Ricardo');
    });
  });
});

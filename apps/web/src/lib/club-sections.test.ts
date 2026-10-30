import { describe, it, expect } from 'vitest';
import { clubTeamLabel, groupClubSections } from './club-sections';

const t = (id: string, o: { section?: string; ageCategory?: string | null; gender?: string | null; squadLevel?: number | null } = {}) =>
  ({ id, section: 'senior', ageCategory: 'senior', gender: 'male', squadLevel: 1, ...o });

describe('groupClubSections', () => {
  it('sénior, sénior femenino, base (de mayor a menor) y veteranos, como OKmob', () => {
    const groups = groupClubSections([
      t('vet', { section: 'veterans', ageCategory: 'veteranos' }),
      t('pre', { section: 'base', ageCategory: 'prebenjamin' }),
      t('fem', { section: 'senior_female', gender: 'female' }),
      t('ale-c', { section: 'base', ageCategory: 'alevin', squadLevel: 3 }),
      t('jun', { section: 'base', ageCategory: 'junior' }),
      t('ale-a', { section: 'base', ageCategory: 'alevin' }),
      t('sen-b', { squadLevel: 2 }),
      t('sen'),
    ]);
    expect(groups.map((g) => [g.section, g.teams.map((x) => x.id)])).toEqual([
      ['senior', ['sen', 'sen-b']],
      ['senior_female', ['fem']],
      ['base', ['jun', 'ale-a', 'ale-c', 'pre']],
      ['veterans', ['vet']],
    ]);
  });

  it('sin sección (API antigua): la deduce de categoría y género', () => {
    const groups = groupClubSections([{ id: 'x', ageCategory: 'infantil', gender: 'male', squadLevel: 1 }]);
    expect(groups[0]!.section).toBe('base');
  });
});

describe('clubTeamLabel', () => {
  it('categoría y letra; femenino solo en base (en sénior lo dice la sección)', () => {
    expect(clubTeamLabel(t('a', { section: 'base', ageCategory: 'alevin', squadLevel: 3 }), 'es')).toBe('Alevín C');
    expect(clubTeamLabel(t('a', { section: 'base', ageCategory: 'infantil', gender: 'female' }), 'es')).toBe('Infantil femenino');
    expect(clubTeamLabel(t('a', { squadLevel: 2 }), 'es')).toBe('Senior B');
    expect(clubTeamLabel(t('a', { section: 'senior_female', gender: 'female' }), 'es')).toBe('Senior');
    expect(clubTeamLabel(t('a', { section: 'base', ageCategory: 'sub23' }), 'es')).toBe('Sub-23');
  });
});

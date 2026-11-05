import { describe, it, expect } from 'vitest';
import { CLUB_COPY, clubJsonLd, clubMetaTitle } from './club-page';
import { SUPPORTED_LOCALES } from './locales';
import type { ClubDetail } from '@sports/core/api';

const data: ClubDetail = {
  club: { id: 'cl1', slug: 'cp-voltrega', name: 'CP Voltregà', city: 'Sant Hipòlit de Voltregà', country: 'ES', crestUrl: null },
  teams: [
    { id: 't1', name: 'CP Voltregà', shortName: null, gender: 'male', ageCategory: 'senior', squadLevel: 1, sectionSuffix: '', competition: null, position: null },
    { id: 't2', name: 'CP Voltregà', shortName: null, gender: 'female', ageCategory: 'senior', squadLevel: 1, sectionSuffix: 'F', competition: null, position: null },
  ],
  recent: [], upcoming: [], indexable: true,
};

describe('club-page', () => {
  it('tiene textos para todos los idiomas soportados', () => {
    for (const l of SUPPORTED_LOCALES) {
      expect(CLUB_COPY[l].teamsCount(2)).toMatch(/2/);
      expect(clubMetaTitle(l, 'CP Voltregà')).toContain('CP Voltregà');
    }
  });

  it('declara el club como SportsOrganization con sus equipos', () => {
    const ld = clubJsonLd('es', data);
    expect(ld['@type']).toBe('SportsOrganization');
    expect(ld['url']).toMatch(/\/es\/clubs\/cp-voltrega$/);
    expect(ld['@id']).toMatch(/\/clubs\/cp-voltrega#club$/);
    expect((ld['subOrganization'] as unknown[]).length).toBe(2);
  });
});

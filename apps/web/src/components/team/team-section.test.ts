import { describe, it, expect } from 'vitest';
import { sectionBadgeText, teamSearchHref, type TeamDetailView } from './TeamCenterClient';

/**
 * #196/#197: desambiguación de secciones en la ficha de equipo. `sectionBadgeText`
 * es pura y recibe `t`, así que aquí usamos la identidad para fijar EXACTAMENTE
 * las claves i18n elegidas (si cambian, el test lo avisa).
 */
const t = (key: string) => key;

describe('sectionBadgeText (#196)', () => {
  it('género + categoría + filial', () => {
    expect(sectionBadgeText({ gender: 'female', ageCategory: 'senior', squadLevel: 1 }, t))
      .toBe('common.female · age_categories.senior');
    expect(sectionBadgeText({ gender: 'male', ageCategory: 'senior', squadLevel: 2 }, t))
      .toBe('common.male · age_categories.senior · team.filial B');
  });

  it('omite categorías sin etiqueta (no pide claves inexistentes)', () => {
    expect(sectionBadgeText({ gender: 'male', ageCategory: 'sub17', squadLevel: 1 }, t))
      .toBe('common.male');
  });

  it('sin datos de sección → vacío', () => {
    expect(sectionBadgeText({}, t)).toBe('');
    expect(sectionBadgeText({ gender: 'mixed', ageCategory: null, squadLevel: 1 }, t)).toBe('');
  });

  it('niveles de filial fuera de rango se recortan a Z', () => {
    expect(sectionBadgeText({ squadLevel: 30 }, t)).toBe('team.filial Z');
  });
});

describe('teamSearchHref (#197)', () => {
  const base = {
    id: 't1', name: 'Igualada Rigat HC', shortName: null, city: null, country: 'ES',
    logoUrl: null, websiteUrl: null, club: null,
  } satisfies TeamDetailView['team'];

  it('prefiltra la búsqueda global por el nombre canónico del club', () => {
    const team = {
      ...base,
      club: { id: 'c1', canonicalName: 'Igualada HC', slug: 'igualada', crestUrl: null, city: null, country: 'ES' },
    };
    expect(teamSearchHref(team)).toBe('/search?q=Igualada%20HC');
  });

  it('sin club cae al nombre del equipo', () => {
    expect(teamSearchHref(base)).toBe('/search?q=Igualada%20Rigat%20HC');
  });
});

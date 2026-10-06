import { describe, it, expect } from 'vitest';
import { sectionBadgeText } from './TeamCenterClient';

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

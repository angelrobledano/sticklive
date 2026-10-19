import { describe, it, expect } from 'vitest';
import { teamSectionLabel } from './team-section-label';

describe('teamSectionLabel (F3-4)', () => {
  it('no añade nada al masculino senior de primer equipo', () => {
    expect(teamSectionLabel({ gender: 'male', ageCategory: 'senior', squadLevel: 1 }, 'es')).toBe('');
    expect(teamSectionLabel({ gender: null, ageCategory: null, squadLevel: 1 }, 'es')).toBe('');
  });

  it('desambigua género, categoría y filial', () => {
    expect(teamSectionLabel({ gender: 'female', ageCategory: 'senior' }, 'es')).toBe('Femenina');
    expect(teamSectionLabel({ gender: 'female', ageCategory: 'sub19' }, 'es')).toBe('Femenina · Sub-19');
    expect(teamSectionLabel({ gender: 'male', ageCategory: 'sub19' }, 'es')).toBe('Sub-19');
    expect(teamSectionLabel({ gender: 'male', ageCategory: 'juvenil' }, 'es')).toBe('Juvenil');
    expect(teamSectionLabel({ gender: 'male', ageCategory: 'senior', squadLevel: 2 }, 'es')).toBe('Filial B');
    expect(teamSectionLabel({ gender: 'female', ageCategory: 'juvenil', squadLevel: 2 }, 'es'))
      .toBe('Femenina · Juvenil · Filial B');
  });

  it('acepta variantes de categoría sub/U', () => {
    expect(teamSectionLabel({ ageCategory: 'Sub 17' }, 'es')).toBe('Sub-17');
    expect(teamSectionLabel({ ageCategory: 'U20' }, 'es')).toBe('Sub-20');
    expect(teamSectionLabel({ ageCategory: 'sub-19' }, 'es')).toBe('Sub-19');
  });

  it('traduce la etiqueta al idioma de la URL', () => {
    expect(teamSectionLabel({ gender: 'female', ageCategory: 'sub19' }, 'en')).toBe("Women's · Sub-19");
    expect(teamSectionLabel({ gender: 'male', squadLevel: 2 }, 'en')).toBe('Reserve team B');
    expect(teamSectionLabel({ gender: 'female' }, 'fr')).toBe('Féminine');
  });
});

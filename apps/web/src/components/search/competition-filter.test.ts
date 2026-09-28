import { describe, it, expect } from 'vitest';
import { normalizeSearchText, filterCompetitions } from './competition-filter';
import type { CompetitionSummary } from '@/lib/api/client';

function comp(name: string, over: Partial<CompetitionSummary> = {}): CompetitionSummary {
  return {
    id: name,
    name,
    shortName: null,
    slug: name.toLowerCase().replace(/\s+/g, '-'),
    gender: null,
    category: null,
    country: 'ES',
    organizer: 'RFEP',
    scope: 'national',
    region: null,
    ageCategory: 'senior',
    season: { id: 's-1', name: '2026/27', isCurrent: true, teamCount: 0, matchCount: 0 },
    ...over,
  };
}

// La web pinta el nombre de país en el idioma activo; aquí lo simplificamos.
const countryName = (code: string | null) => (code === 'ES' ? 'España' : '');

describe('normalizeSearchText', () => {
  it('pasa a minúsculas y quita acentos', () => {
    expect(normalizeSearchText('Primera División')).toBe('primera division');
    expect(normalizeSearchText('Copa del Rey')).toBe('copa del rey');
  });
});

describe('filterCompetitions (#256)', () => {
  it('encuentra competiciones cuyo nombre real llevaba 0 resultados', () => {
    const comps = [
      comp('Copa del Rey'),
      comp('Copa de la Reina'),
      comp('Copa SAR la Princesa Masculina'),
      comp('Primera División'),
      comp('OK Liga Masculina'),
    ];
    expect(filterCompetitions(comps, 'copa del rey', countryName).map((c) => c.name)).toEqual(['Copa del Rey']);
    expect(filterCompetitions(comps, 'reina', countryName).map((c) => c.name)).toEqual(['Copa de la Reina']);
    expect(filterCompetitions(comps, 'princesa', countryName).map((c) => c.name)).toEqual(['Copa SAR la Princesa Masculina']);
  });

  it('casa sin acentos lo que teclea el usuario', () => {
    const comps = [comp('Primera División')];
    expect(filterCompetitions(comps, 'primera division', countryName)).toHaveLength(1);
  });

  it('NO oculta una competición por su temporada (busca en todas)', () => {
    const old = comp('Europeo Sub-17', {
      season: { id: 's-old', name: '2025/26', isCurrent: false, teamCount: 8, matchCount: 12 },
    });
    expect(filterCompetitions([old], 'europeo', countryName)).toEqual([old]);
  });

  it('casa también por shortName, país, región y organizador', () => {
    const comps = [
      comp('OK Liga', { shortName: 'OKL' }),
      comp('Liga Andaluza', { region: 'Andalucía' }),
      comp('Torneo Federativo', { organizer: 'Federació Catalana' }),
    ];
    expect(filterCompetitions(comps, 'okl', countryName).map((c) => c.name)).toEqual(['OK Liga']);
    expect(filterCompetitions(comps, 'espana', countryName).map((c) => c.name)).toEqual([
      'OK Liga', 'Liga Andaluza', 'Torneo Federativo',
    ]);
    expect(filterCompetitions(comps, 'andalucia', countryName).map((c) => c.name)).toEqual(['Liga Andaluza']);
    expect(filterCompetitions(comps, 'catalana', countryName).map((c) => c.name)).toEqual(['Torneo Federativo']);
  });

  it('sin término devuelve la lista completa; sin match devuelve vacío', () => {
    const comps = [comp('Copa del Rey'), comp('OK Liga Masculina')];
    expect(filterCompetitions(comps, '   ', countryName)).toHaveLength(2);
    expect(filterCompetitions(comps, 'zzz', countryName)).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import {
  normalizeSearchText,
  filterCompetitions,
  matchRelevance,
  orderSearchResults,
} from './competition-filter';
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

  it('casa por el nombre traducido (nameI18n) aunque no esté en name/shortName (#262)', () => {
    const comps = [comp('Copa del Rey', { nameI18n: { es: 'Copa del Rey', en: 'Spanish Cup' } })];
    expect(filterCompetitions(comps, 'spanish', countryName)).toHaveLength(1);
    expect(filterCompetitions(comps, 'spanish cup', countryName)).toHaveLength(1);
    // Y sin acentos en el campo traducido.
    const accented = [comp('X', { nameI18n: { pt: 'Taça de Portugal' } })];
    expect(filterCompetitions(accented, 'taca', countryName)).toHaveLength(1);
  });
});

describe('matchRelevance (#260)', () => {
  it('0 exacto, 1 prefijo, 2 inicio de palabra, 3 contiene', () => {
    expect(matchRelevance(comp('Copa del Rey'), 'copa del rey')).toBe(0);
    expect(matchRelevance(comp('Copa del Rey Juvenil'), 'copa del rey')).toBe(1);
    expect(matchRelevance(comp('Liga OK Femenina'), 'liga')).toBe(1);
    expect(matchRelevance(comp('Gran Copa del Rey'), 'copa del rey')).toBe(3);
    expect(matchRelevance(comp('Femenina OK Liga'), 'liga')).toBe(2);
  });

  it('considera también el shortName y el nameI18n', () => {
    expect(matchRelevance(comp('X', { shortName: 'OKL' }), 'okl')).toBe(0);
    expect(matchRelevance(comp('X', { nameI18n: { en: 'King Cup' } }), 'king')).toBe(1);
  });
});

describe('orderSearchResults (#260)', () => {
  it('prioriza exacto > prefijo > contiene, por encima de la importancia', () => {
    const exact = comp('Copa del Rey', { slug: 'zzz-desconocida' });
    const prefix = comp('Copa del Rey Juvenil', { slug: 'zzz-desconocida' });
    const inner = comp('Gran Copa del Rey', { slug: 'ok-liga-masculina' });
    const ordered = orderSearchResults([inner, prefix, exact], 'copa del rey', 'es');
    expect(ordered.map((c) => c.name)).toEqual([
      'Copa del Rey',
      'Copa del Rey Juvenil',
      'Gran Copa del Rey',
    ]);
  });

  it('en empate de relevancia desempata por importancia y luego por nombre', () => {
    const important = comp('Zona Liga', { slug: 'ok-liga-masculina' });
    const minor = comp('Alfa Liga', { slug: 'copa-del-rey' });
    const ordered = orderSearchResults([minor, important], 'liga', 'es');
    expect(ordered.map((c) => c.name)).toEqual(['Zona Liga', 'Alfa Liga']);
  });

  it('no muta la lista de entrada', () => {
    const comps = [comp('Gran Copa del Rey'), comp('Copa del Rey')];
    const copia = [...comps];
    orderSearchResults(comps, 'copa del rey', 'es');
    expect(comps).toEqual(copia);
  });

  it('sin término ordena por importancia (delega en orderByImportance)', () => {
    const minor = comp('Alfa', { slug: 'copa-del-rey' });
    const important = comp('Zeta', { slug: 'ok-liga-masculina' });
    expect(orderSearchResults([minor, important], '', 'es').map((c) => c.name)).toEqual(['Zeta', 'Alfa']);
  });
});

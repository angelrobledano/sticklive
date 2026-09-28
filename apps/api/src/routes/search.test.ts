import { describe, it, expect } from 'vitest';

// `@sports/db` exige DATABASE_URL al importarse (aunque el pool no conecta hasta
// la primera query). Fijamos una de mentira ANTES del import dinámico para poder
// testear la lógica pura de la ruta sin levantar Postgres.
process.env['DATABASE_URL'] ??= 'postgres://localhost:5432/test';

const {
  MIN_SEARCH_LENGTH,
  MAX_SEARCH_LENGTH,
  normalizeSearchTerm,
  parseSearchQuery,
  unaccentExpr,
  ACCENTS_FROM,
  ACCENTS_TO,
  buildSearchResults,
} = await import('./search.js');

describe('normalizeSearchTerm', () => {
  it('recorta, colapsa espacios y pasa a minúsculas', () => {
    expect(normalizeSearchTerm('  Copa   del   Rey ')).toBe('copa del rey');
  });

  it('quita acentos y diéresis para casar lo que teclea el usuario', () => {
    expect(normalizeSearchTerm('Primera División')).toBe('primera division');
    expect(normalizeSearchTerm('Ñandú')).toBe('nandu');
    expect(normalizeSearchTerm('Copa da Rainha')).toBe('copa da rainha');
  });

  it('no altera un término ya plano', () => {
    expect(normalizeSearchTerm('noia')).toBe('noia');
  });
});

describe('parseSearchQuery', () => {
  it('devuelve null por debajo de la longitud mínima', () => {
    expect(parseSearchQuery(undefined)).toBeNull();
    expect(parseSearchQuery('')).toBeNull();
    expect(parseSearchQuery('   ')).toBeNull();
    expect(parseSearchQuery('a')).toBeNull();
    expect(parseSearchQuery(` ${'a'.repeat(MIN_SEARCH_LENGTH - 1)} `)).toBeNull();
  });

  it('acepta y normaliza un término válido', () => {
    expect(parseSearchQuery('  Noia  ')).toBe('noia');
    expect(parseSearchQuery('ab')).toBe('ab');
  });

  it('acota la longitud máxima del término', () => {
    expect(parseSearchQuery('a'.repeat(200))).toHaveLength(MAX_SEARCH_LENGTH);
  });
});

describe('unaccentExpr', () => {
  it('las tablas de acentos tienen la misma longitud (requisito de translate)', () => {
    expect(ACCENTS_FROM.length).toBe(ACCENTS_TO.length);
    expect(ACCENTS_FROM.length).toBeGreaterThan(0);
  });

  it('envuelve la columna en lower + translate', () => {
    expect(unaccentExpr('t.name')).toBe(
      `translate(lower(t.name), '${ACCENTS_FROM}', '${ACCENTS_TO}')`,
    );
  });
});

describe('buildSearchResults', () => {
  const teamRows = [
    { id: 't1', name: 'HC Noia', short_name: 'NOIA', logo_url: null, country: 'ES' },
  ];
  const playerRows = [
    { id: 'p1', first_name: 'Ferran', last_name: 'Font', photo_url: null, team_name: 'FC Barcelona' },
  ];
  const competitionRows = [
    {
      id: 'c1',
      name: 'Copa del Rey',
      name_i18n: { es: 'Copa del Rey' },
      short_name: 'CDR',
      country: 'ES',
      scope: 'national',
      season_name: '2025/26',
    },
  ];

  it('agrupa y totaliza los tres tipos de resultado', () => {
    const out = buildSearchResults('rey', teamRows, playerRows, competitionRows);
    expect(out.query).toBe('rey');
    expect(out.total).toBe(3);
    expect(out.teams).toHaveLength(1);
    expect(out.players).toHaveLength(1);
    expect(out.competitions).toHaveLength(1);
  });

  it('mapea snake_case de la BD a camelCase del DTO', () => {
    const out = buildSearchResults('noia', teamRows, playerRows, competitionRows);
    expect(out.teams[0]).toEqual({
      id: 't1', name: 'HC Noia', shortName: 'NOIA', logoUrl: null, country: 'ES',
    });
    expect(out.players[0]).toEqual({
      id: 'p1', firstName: 'Ferran', lastName: 'Font', photoUrl: null, teamName: 'FC Barcelona',
    });
    expect(out.competitions[0]).toEqual({
      id: 'c1',
      name: 'Copa del Rey',
      nameI18n: { es: 'Copa del Rey' },
      shortName: 'CDR',
      country: 'ES',
      scope: 'national',
      seasonName: '2025/26',
    });
  });

  it('sin resultados devuelve grupos vacíos y total 0', () => {
    const out = buildSearchResults('zzz', [], [], []);
    expect(out).toEqual({ query: 'zzz', total: 0, teams: [], players: [], competitions: [] });
  });
});

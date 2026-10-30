import { describe, it, expect, vi, afterEach } from 'vitest';
import { SEARCH_MIN_LENGTH, normalizeSearchQuery, isSearchable, searchAll, arrangeSearchResults } from './search';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('normalizeSearchQuery', () => {
  it('recorta y colapsa espacios internos', () => {
    expect(normalizeSearchQuery('  Copa   del  Rey ')).toBe('Copa del Rey');
    expect(normalizeSearchQuery(null)).toBe('');
    expect(normalizeSearchQuery(undefined)).toBe('');
  });
});

describe('isSearchable', () => {
  it('exige la longitud mínima tras normalizar', () => {
    expect(isSearchable('')).toBe(false);
    expect(isSearchable(' a ')).toBe(false);
    expect(isSearchable('a'.repeat(SEARCH_MIN_LENGTH - 1))).toBe(false);
    expect(isSearchable('a'.repeat(SEARCH_MIN_LENGTH))).toBe(true);
  });
});

describe('searchAll', () => {
  const payload = {
    query: 'copa del rey',
    total: 2,
    teams: [{ id: 't1', name: 'HC Noia', shortName: null, logoUrl: null, country: 'ES' }],
    players: [],
    competitions: [{
      id: 'c1', name: 'Copa del Rey', nameI18n: null, shortName: null,
      country: 'ES', scope: 'national', seasonName: '2025/26',
    }],
    clubs: [{ id: 'cl1', slug: 'hc-noia', name: 'HC Noia', city: null, crestUrl: null, teamCount: 3 }],
  };

  it('codifica el término y llama a /search?q=', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => payload }));
    vi.stubGlobal('fetch', fetchMock);
    const api = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000';

    const res = await searchAll('  Copa   del Rey ');

    expect(fetchMock).toHaveBeenCalledWith(
      `${api}/search?q=Copa%20del%20Rey`,
      expect.objectContaining({ cache: 'no-store' }),
    );
    expect(res).toEqual(payload);
  });

  it('tolera grupos ausentes en la respuesta (los deja vacíos)', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ query: 'x', total: 0 }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await searchAll('xy');
    expect(res.teams).toEqual([]);
    expect(res.players).toEqual([]);
    expect(res.competitions).toEqual([]);
  });
});

describe('arrangeSearchResults (30/10/2026: cinco «CD Claret»)', () => {
  const team = (id: string, clubId: string | null) => ({ id, name: 'CD CLARET', shortName: null, logoUrl: null, country: 'ES', clubId });
  it('los equipos de un club listado no se repiten; los sueltos sí; el club lleva un escudo', () => {
    const out = arrangeSearchResults({
      query: 'claret', total: 4, players: [], competitions: [],
      clubs: [{ id: 'cl1', slug: 'cd-claret', name: 'CD Claret', city: 'Sevilla', crestUrl: null, teamCount: 5 }],
      teams: [team('a', 'cl1'), team('b', 'cl1'), team('suelto', null), team('otro-club', 'cl9')],
    });
    expect(out.clubs).toEqual([expect.objectContaining({ id: 'cl1', shieldTeamId: 'a' })]);
    expect(out.teams.map((t) => t.id)).toEqual(['suelto', 'otro-club']);
  });
  it('API antigua sin clubs: todo igual', () => {
    const out = arrangeSearchResults({ query: 'x', total: 1, players: [], competitions: [], teams: [team('a', null)] });
    expect(out.clubs).toEqual([]);
    expect(out.teams).toHaveLength(1);
  });
});

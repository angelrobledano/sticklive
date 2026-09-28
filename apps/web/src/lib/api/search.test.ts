import { describe, it, expect, vi, afterEach } from 'vitest';
import { SEARCH_MIN_LENGTH, normalizeSearchQuery, isSearchable, searchAll } from './search';

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

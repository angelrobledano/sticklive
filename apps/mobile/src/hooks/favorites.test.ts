import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addLocalFavorite,
  mergeFavoritesIntoRequest,
  mergeLocalOnLogin,
  removeLocalFavorite,
  loadLocalFavorites,
  saveLocalFavorites,
  type LocalFavorites,
} from './favorites';

/**
 * Tests de la lógica de favoritos SIN renderizar (mismo ajuste que
 * queries.test.ts): funciones puras + funciones asíncronas con AsyncStorage
 * mockeado (código NATIVO: en vitest/node no existe; patrón de
 * session.test.ts con vi.hoisted) y fetch global stubeado para el POST de
 * merge (patrón de queries.test.ts). El cableado de los hooks (useMutation/
 * useQuery) vive en los componentes y se verifica con el build de export.
 */

// AsyncStorage es código NATIVO: en vitest (node) hay que mockearlo.
const { store } = vi.hoisted(() => ({ store: new Map<string, string>() }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => store.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => void store.set(k, v)),
    removeItem: vi.fn(async (k: string) => void store.delete(k)),
  },
}));

// analytics importa posthog-react-native (SDK real no parseable en node):
// los captures de las mutaciones se mockean (los asserts del wrapper viven en
// analytics.test.ts).
const { captureMock } = vi.hoisted(() => ({ captureMock: vi.fn() }));
vi.mock('@/src/lib/analytics', () => ({ capture: captureMock }));

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

const local = (over: Partial<LocalFavorites> = {}): LocalFavorites => ({
  teams: [],
  leagues: [],
  players: [],
  ...over,
});

beforeEach(() => store.clear());
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('mergeFavoritesIntoRequest', () => {
  it('construye el body de merge desde el estado local', () => {
    const state = { teams: ['t1'], leagues: ['l1', 'l2'], players: [] };
    expect(mergeFavoritesIntoRequest(state)).toEqual({
      teams: ['t1'],
      leagues: ['l1', 'l2'],
      players: [],
    });
  });

  it('no envia mas de 200 por tipo (cap del API)', () => {
    const teams = Array.from({ length: 300 }, (_, i) => `t${i}`);
    const leagues = Array.from({ length: 250 }, (_, i) => `l${i}`);
    const players = Array.from({ length: 201 }, (_, i) => `p${i}`);
    const body = mergeFavoritesIntoRequest({ teams, leagues, players });
    expect(body.teams.length).toBe(200);
    expect(body.leagues.length).toBe(200);
    expect(body.players.length).toBe(200);
  });
});

describe('estado local (AsyncStorage)', () => {
  it('loadLocalFavorites devuelve el vacío cuando no hay nada guardado', async () => {
    expect(await loadLocalFavorites()).toEqual({ teams: [], leagues: [], players: [] });
  });

  it('guarda y carga redondeando con AsyncStorage', async () => {
    const state = { teams: ['t1'], leagues: ['l1'], players: ['p1'] };
    await saveLocalFavorites(state);
    expect(await loadLocalFavorites()).toEqual(state);
  });

  it('loadLocalFavorites completa los tipos que falten en lo guardado', async () => {
    await saveLocalFavorites({ teams: ['t1'], leagues: [], players: [] });
    store.clear();
    // JSON antiguo sin 'players': el merge con el vacío lo completa.
    store.set('sticklive.favorites.local', JSON.stringify({ teams: ['t1'] }));
    expect(await loadLocalFavorites()).toEqual({ teams: ['t1'], leagues: [], players: [] });
  });
});

describe('addLocalFavorite / removeLocalFavorite (funciones puras)', () => {
  it('add añade por kind sin duplicar y toca solo ese tipo', () => {
    const state = local({ teams: ['t1'], leagues: ['l1'] });
    expect(addLocalFavorite(state, 'team', 't1')).toEqual({ teams: ['t1'], leagues: ['l1'], players: [] });
    expect(addLocalFavorite(state, 'team', 't2')).toEqual({ teams: ['t1', 't2'], leagues: ['l1'], players: [] });
    expect(addLocalFavorite(state, 'player', 'p1')).toEqual({ teams: ['t1'], leagues: ['l1'], players: ['p1'] });
  });

  it('remove quita solo el refId del kind indicado', () => {
    const state = local({ teams: ['t1', 't2'], leagues: ['l1'], players: ['p1'] });
    expect(removeLocalFavorite(state, 'team', 't1')).toEqual({ teams: ['t2'], leagues: ['l1'], players: ['p1'] });
    expect(removeLocalFavorite(state, 'league', 'l1')).toEqual({ teams: ['t1', 't2'], leagues: [], players: ['p1'] });
    // Quitar algo que no está es un no-op (idempotente).
    expect(removeLocalFavorite(state, 'player', 'pX')).toEqual(state);
  });
});

describe('mergeLocalOnLogin', () => {
  it('envía los favoritos locales al merge y el estado local pasa a espejo del servidor', async () => {
    await saveLocalFavorites({ teams: ['t1'], leagues: ['l1'], players: [] });
    const server = { teams: ['t1', 'srv1'], leagues: [], players: ['srv-p1'] };
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => ok(server));
    vi.stubGlobal('fetch', fetchMock);

    await mergeLocalOnLogin('tok');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/auth/favorites/merge'),
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body).toEqual({ teams: ['t1'], leagues: ['l1'], players: [] });
    // Espejo: lo local queda sustituido por la respuesta del servidor.
    expect(await loadLocalFavorites()).toEqual(server);
  });

  it('si el merge falla (red), el estado local NO se pierde', async () => {
    await saveLocalFavorites({ teams: ['t1'], leagues: [], players: [] });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network down'); }));

    await expect(mergeLocalOnLogin('tok')).rejects.toThrow();
    // El save sólo ocurre tras respuesta OK: los locales sobreviven y el
    // usuario puede reintentar el merge con el próximo login.
    expect(await loadLocalFavorites()).toEqual({ teams: ['t1'], leagues: [], players: [] });
  });
});

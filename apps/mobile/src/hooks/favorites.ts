import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiFetch } from '@/src/lib/api/client';
import { qk, useFavorites } from './queries';

/**
 * Favoritos (Task 3.3): ANÓNIMOS viven en AsyncStorage; CON SESIÓN en el API
 * (`GET/DELETE /auth/favorites`, `POST /auth/favorites/merge` — idempotente,
 * cap 200/kind, refs UUID). kind 'league' = competición (nomenclatura del API).
 *
 * Al iniciar sesión `mergeLocalOnLogin` envía lo local al merge y deja el
 * estado local como ESPEJO del servidor (así, al cerrar sesión, el usuario no
 * pierde de vista lo que seguía con la cuenta).
 */

const LOCAL_KEY = 'sticklive.favorites.local';

export interface LocalFavorites {
  teams: string[];
  leagues: string[];
  players: string[];
}

/** Nomenclatura del API (valida UUIDs: buildFavoritePairs en auth.ts). */
export type FavoriteKind = 'team' | 'league' | 'player';

/** kind (singular, API) → clave del estado (plural, listas). Mismo shape en
 * FavoritesResponse (servidor) y LocalFavorites (local): lo consume FollowButton. */
export const PLURAL: Record<FavoriteKind, keyof LocalFavorites> = {
  team: 'teams',
  league: 'leagues',
  player: 'players',
};

const EMPTY: LocalFavorites = { teams: [], leagues: [], players: [] };
/** Cap del API por tipo: más de 200 → 400 (favorites.ts del API). */
const CAP = 200;

/** Body de merge desde el estado local, respetando el cap de 200/kind. */
export function mergeFavoritesIntoRequest(local: LocalFavorites) {
  return {
    teams: local.teams.slice(0, CAP),
    leagues: local.leagues.slice(0, CAP),
    players: local.players.slice(0, CAP),
  };
}

export async function loadLocalFavorites(): Promise<LocalFavorites> {
  // Merge con el vacío: completa tipos que falten en JSON guardado por
  // versiones anteriores. Un JSON corrupto NO se traga: rechaza (regla del
  // repo: los fallos son explícitos; el storage corrupto es anómalo).
  const stored = await AsyncStorage.getItem(LOCAL_KEY).then((v) =>
    v ? (JSON.parse(v) as Partial<LocalFavorites>) : null,
  );
  return { ...EMPTY, ...stored };
}

export async function saveLocalFavorites(f: LocalFavorites): Promise<void> {
  await AsyncStorage.setItem(LOCAL_KEY, JSON.stringify(f));
}

// ── Funciones puras (testeables sin renderizar; los hooks las envuelven) ────

/** Añade un refId al kind indicado (unión de conjuntos: idempotente). */
export function addLocalFavorite(local: LocalFavorites, kind: FavoriteKind, refId: string): LocalFavorites {
  const key = PLURAL[kind];
  if (local[key].includes(refId)) return local;
  return { ...local, [key]: [...local[key], refId] };
}

/** Quita un refId del kind indicado (idempotente: quitar lo ausente es no-op). */
export function removeLocalFavorite(local: LocalFavorites, kind: FavoriteKind, refId: string): LocalFavorites {
  const key = PLURAL[kind];
  return { ...local, [key]: local[key].filter((x) => x !== refId) };
}

// ── Hooks ────────────────────────────────────────────────────────────────────

/**
 * Favoritos ANÓNIMOS como query: FollowButton lee de aquí sin sesión y las
 * mutaciones lo invalidan para reaccionar (desviación mínima del snippet del
 * plan, que sólo invalidaba `qk.favorites`; sin esto la estrella anónima no
 * se actualiza de forma reactiva).
 */
export const LOCAL_FAVORITES_QUERY_KEY = ['favorites', 'local'] as const;

export function useLocalFavorites(enabled: boolean) {
  return useQuery({
    queryKey: LOCAL_FAVORITES_QUERY_KEY,
    queryFn: loadLocalFavorites,
    enabled,
    staleTime: Infinity, // fuente: AsyncStorage; las mutaciones invalidan
  });
}

/** Añade 1 favorito (el merge idempotente del API admite 1 elemento). */
export function useAddFavorite(token: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ kind, refId }: { kind: FavoriteKind; refId: string }) => {
      if (token) {
        await apiFetch('/auth/favorites/merge', {
          method: 'POST',
          token,
          body: mergeFavoritesIntoRequest({
            teams: kind === 'team' ? [refId] : [],
            leagues: kind === 'league' ? [refId] : [],
            players: kind === 'player' ? [refId] : [],
          }),
        });
      } else {
        await saveLocalFavorites(addLocalFavorite(await loadLocalFavorites(), kind, refId));
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.favorites });
      void qc.invalidateQueries({ queryKey: LOCAL_FAVORITES_QUERY_KEY });
    },
  });
}

export function useRemoveFavorite(token: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ kind, refId }: { kind: FavoriteKind; refId: string }) => {
      if (token) {
        await apiFetch('/auth/favorites', { method: 'DELETE', token, body: { kind, refId } });
      } else {
        await saveLocalFavorites(removeLocalFavorite(await loadLocalFavorites(), kind, refId));
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.favorites });
      void qc.invalidateQueries({ queryKey: LOCAL_FAVORITES_QUERY_KEY });
    },
  });
}

/**
 * Al iniciar sesión: fusiona los favoritos locales anónimos con la cuenta
 * (merge idempotente) y deja el estado local como espejo del servidor. Si
 * falla (red), rechaza: el llamador (AuthContext) decide cómo exponerlo y el
 * estado local queda intacto (reintentable con el próximo login).
 */
export async function mergeLocalOnLogin(token: string): Promise<void> {
  const local = await loadLocalFavorites();
  const server = await apiFetch<LocalFavorites>('/auth/favorites/merge', {
    method: 'POST',
    token,
    body: mergeFavoritesIntoRequest(local),
  });
  await saveLocalFavorites(server);
}

export { useFavorites };

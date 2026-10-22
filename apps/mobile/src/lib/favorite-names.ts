import AsyncStorage from '@react-native-async-storage/async-storage';
import type { QueryClient } from '@tanstack/react-query';
import { qk } from '@/src/hooks/queries';
import type { FavoriteKind } from '@/src/hooks/favorites';
import type {
  CompetitionsResponse,
  PlayerDetail,
  SearchResults,
  StandingsResponse,
  TeamDetail,
} from '@/src/lib/api/types';

/**
 * Nombre visible de un favorito desde la CACHÉ persistida y queries ya visitadas
 * (fichas team/player, standings, competitions, search).
 *
 * Los nombres resueltos se persisten en AsyncStorage bajo `favorites_names_cache_v1`
 * para garantizar que tras un reinicio de la app (arranque en frío) no se muestren
 * etiquetas genéricas («Equipo» / «Jugador») mientras hidrata la red.
 */

const STORAGE_KEY = 'favorites_names_cache_v1';
const memoryNameCache: Record<string, string> = {};

// Carga inicial en frío desde AsyncStorage (no bloqueante)
void AsyncStorage.getItem(STORAGE_KEY)
  .then((raw) => {
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Record<string, string>;
        if (parsed && typeof parsed === 'object') {
          Object.assign(memoryNameCache, parsed);
        }
      } catch {
        // Fallback fail-safe
      }
    }
  })
  .catch(() => {});

export function saveFavoriteName(id: string, name: string): void {
  if (!id || !name) return;
  memoryNameCache[id] = name;
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(memoryNameCache)).catch(() => {});
}

export function getPersistedFavoriteName(id: string): string | null {
  return memoryNameCache[id] ?? null;
}

/** Placeholders cuando el nombre no está en caché: claves i18n resueltas con
 * t() en el punto de uso (Task 5.2; singulares nuevos en los 5 locales bajo
 * favorites.placeholder_*). La lib sigue siendo pura, sin React. */
export const PLACEHOLDER_KEY: Record<FavoriteKind, string> = {
  team: 'favorites.placeholder_team',
  league: 'favorites.placeholder_league',
  player: 'favorites.placeholder_player',
};

export function resolveFavoriteName(qc: QueryClient, kind: FavoriteKind, id: string): string | null {
  // 1. Si ya se resolvió y persistió, responder inmediatamente (evita "Equipo"/"Jugador" en frío)
  const cached = memoryNameCache[id];
  if (cached) return cached;

  let resolved: string | null = null;
  if (kind === 'team') {
    const detail = qc.getQueryData<TeamDetail>(qk.team(id));
    if (detail) resolved = detail.team.name;
    if (!resolved) {
      for (const q of qc.getQueryCache().findAll({ queryKey: ['search'] })) {
        const hit = (q.state.data as SearchResults | undefined)?.teams.find((x) => x.id === id);
        if (hit) { resolved = hit.name; break; }
      }
    }
    if (!resolved) {
      for (const q of qc.getQueryCache().findAll({ queryKey: ['standings'] })) {
        const row = (q.state.data as StandingsResponse | undefined)?.standings.find((r) => r.team_id === id);
        if (row) { resolved = row.team_short_name ?? row.team_name; break; }
      }
    }
  } else if (kind === 'player') {
    const detail = qc.getQueryData<PlayerDetail>(qk.player(id));
    if (detail) resolved = `${detail.player.firstName} ${detail.player.lastName}`;
    if (!resolved) {
      for (const q of qc.getQueryCache().findAll({ queryKey: ['search'] })) {
        const hit = (q.state.data as SearchResults | undefined)?.players.find((x) => x.id === id);
        if (hit) { resolved = `${hit.firstName} ${hit.lastName}`; break; }
      }
    }
  } else if (kind === 'league') {
    const comps = qc.getQueryData<CompetitionsResponse>(qk.competitions);
    const comp = comps?.competitions.find((c) => c.id === id);
    if (comp) resolved = comp.name;
    if (!resolved) {
      for (const q of qc.getQueryCache().findAll({ queryKey: ['search'] })) {
        const hit = (q.state.data as SearchResults | undefined)?.competitions.find((x) => x.id === id);
        if (hit) { resolved = hit.name; break; }
      }
    }
  }

  if (resolved) {
    saveFavoriteName(id, resolved);
    return resolved;
  }
  return null;
}

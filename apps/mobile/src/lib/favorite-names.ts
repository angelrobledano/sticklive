import AsyncStorage from '@react-native-async-storage/async-storage';
import type { QueryClient } from '@tanstack/react-query';
import { qk } from '@/src/hooks/queries';
import type { FavoriteKind } from '@/src/hooks/favorites';
import type {
  CompetitionsResponse,
  CompetitionSummary,
  CurrentMatchesResponse,
  PlayerDetail,
  SearchResults,
  SeasonOverview,
  SeasonStats,
  StandingsResponse,
  TeamDetail,
} from '@/src/lib/api/types';

/**
 * Nombre visible de un favorito desde la CACHÉ persistida y queries ya visitadas
 * (fichas team/player, standings, competitions, matches current, search).
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
  if (!id) return null;

  // 1. Si ya se resolvió y persistió, responder inmediatamente (evita "Equipo"/"Jugador" en frío)
  const cached = memoryNameCache[id];
  if (cached) return cached;

  let resolved: string | null = null;
  if (kind === 'team') {
    const detail = qc.getQueryData<TeamDetail>(qk.team(id));
    if (detail?.team?.name) resolved = detail.team.name;

    // Buscar en partidos actuales / home / away
    if (!resolved) {
      // Cualquier listado de partidos en caché: feed, día completo, lo seguido…
      const lists = qc.getQueryCache().findAll({ queryKey: qk.current })
        .map((q) => q.state.data as CurrentMatchesResponse | undefined);
      for (const current of lists) {
        if (resolved || !current?.matches) continue;
        for (const m of current.matches) {
          if (m.homeTeam?.id === id && m.homeTeam.name) {
            resolved = m.homeTeam.name;
            break;
          }
          if (m.awayTeam?.id === id && m.awayTeam.name) {
            resolved = m.awayTeam.name;
            break;
          }
        }
      }
    }

    // Buscar en standings
    if (!resolved) {
      for (const q of qc.getQueryCache().findAll({ queryKey: ['standings'] })) {
        const row = (q.state.data as StandingsResponse | undefined)?.standings.find((r) => r.team_id === id);
        if (row) {
          resolved = row.team_short_name ?? row.team_name;
          break;
        }
      }
    }

    // Buscar en season overview (standings o partidos)
    if (!resolved) {
      for (const q of qc.getQueryCache().findAll({ queryKey: ['seasons'] })) {
        const overview = q.state.data as SeasonOverview | undefined;
        const row = overview?.standings?.find((s) => s.teamId === id);
        if (row) {
          resolved = row.teamShortName ?? row.teamName;
          break;
        }
      }
    }

    // Buscar en search
    if (!resolved) {
      for (const q of qc.getQueryCache().findAll({ queryKey: ['search'] })) {
        const hit = (q.state.data as SearchResults | undefined)?.teams.find((x) => x.id === id);
        if (hit?.name) {
          resolved = hit.name;
          break;
        }
      }
    }
  } else if (kind === 'player') {
    const detail = qc.getQueryData<PlayerDetail>(qk.player(id));
    if (detail?.player) resolved = `${detail.player.firstName ?? ''} ${detail.player.lastName ?? ''}`.trim();

    // Buscar en plantillas de equipos en caché
    if (!resolved) {
      for (const q of qc.getQueryCache().findAll({ queryKey: ['teams'] })) {
        const teamDetail = q.state.data as TeamDetail | undefined;
        const p = teamDetail?.squad?.find((x) => x.playerId === id);
        if (p) {
          resolved = `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim();
          break;
        }
      }
    }

    // Buscar en estadísticas de temporada (goleadores, asistencias, tarjetas)
    if (!resolved) {
      for (const q of qc.getQueryCache().findAll({ queryKey: ['seasons'] })) {
        const stats = q.state.data as SeasonStats | undefined;
        if (stats) {
          const hit =
            stats.topScorers?.find((x) => x.playerId === id) ??
            stats.topAssists?.find((x) => x.playerId === id) ??
            stats.topCards?.find((x) => x.playerId === id);
          if (hit?.playerName) {
            resolved = hit.playerName;
            break;
          }
        }
      }
    }

    // Buscar en search
    if (!resolved) {
      for (const q of qc.getQueryCache().findAll({ queryKey: ['search'] })) {
        const hit = (q.state.data as SearchResults | undefined)?.players.find((x) => x.id === id);
        if (hit) {
          resolved = `${hit.firstName ?? ''} ${hit.lastName ?? ''}`.trim();
          break;
        }
      }
    }
  } else if (kind === 'league') {
    const compsData = qc.getQueryData<CompetitionsResponse | CompetitionSummary[]>(qk.competitions);
    const comps = Array.isArray(compsData) ? compsData : compsData?.competitions;
    const comp = comps?.find((c) => c.id === id);
    if (comp?.name) resolved = comp.name;

    if (!resolved) {
      for (const q of qc.getQueryCache().findAll({ queryKey: ['search'] })) {
        const hit = (q.state.data as SearchResults | undefined)?.competitions.find((x) => x.id === id);
        if (hit?.name) {
          resolved = hit.name;
          break;
        }
      }
    }
  }

  if (resolved) {
    saveFavoriteName(id, resolved);
    return resolved;
  }
  return null;
}

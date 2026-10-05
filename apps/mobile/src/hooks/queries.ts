import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/src/lib/api/client';
import type {
  CompetitionSummary,
  CompetitionsResponse,
  CurrentMatchesResponse,
  FavoritesResponse,
  MatchDetail,
  MatchSummary,
  PlayerDetail,
  SearchResults,
  StandingsResponse,
  StandingsRow,
  TeamDetail,
} from '@/src/lib/api/types';

/**
 * Claves de query. Las consume la UI para invalidaciones puntuales
 * (p. ej. `qc.invalidateQueries({ queryKey: qk.favorites })`).
 */
export const qk = {
  current: ['matches', 'current'] as const,
  match: (id: string) => ['matches', id] as const,
  competitions: ['competitions'] as const,
  standings: (seasonId: string) => ['standings', seasonId] as const,
  search: (q: string) => ['search', q] as const,
  favorites: ['favorites'] as const,
  team: (id: string) => ['teams', id] as const,
  player: (id: string) => ['players', id] as const,
};

// ── Gating y selectores puros ────────────────────────────────────────────────
// Extraídos a funciones puras para poder testearlos sin renderizar (los tests
// no usan @testing-library/react-native; ver queries.test.ts).

/** Mismo mínimo que el API: apps/api/src/routes/search.ts:9 (MIN_SEARCH_LENGTH). */
export const MIN_SEARCH_LENGTH = 2;

/** Gating de /search: mínimo efectivo tras trim (función pura testeada). */
export const searchEnabled = (q: string): boolean => q.trim().length >= MIN_SEARCH_LENGTH;

export const standingsEnabled = (seasonId: string | undefined): boolean => Boolean(seasonId);

export const favoritesEnabled = (token: string | null | undefined): boolean => Boolean(token);

/** `/matches/current` y `/matches/live` devuelven `{ count, matches }` (live.ts:240-241). */
export const selectCurrentMatches = (d: CurrentMatchesResponse): MatchSummary[] => d.matches;

/** `/competitions` devuelve `{ count, competitions }` (competitions.ts:121). */
export const selectCompetitions = (d: CompetitionsResponse): CompetitionSummary[] => d.competitions;

/** `/seasons/:id/standings` devuelve `{ seasonId, group, count, standings }` (standings.ts:40-45). */
export const selectStandings = (d: StandingsResponse): StandingsRow[] => d.standings;

// ── QueryFns (exportados para testearlos con fetchQuery + fetch stubeado) ───

export async function fetchCurrentMatches(): Promise<CurrentMatchesResponse> {
  return apiFetch<CurrentMatchesResponse>('/matches/current');
}

export async function fetchCompetitions(): Promise<CompetitionsResponse> {
  return apiFetch<CompetitionsResponse>('/competitions');
}

export async function fetchStandings(seasonId: string): Promise<StandingsResponse> {
  return apiFetch<StandingsResponse>(`/seasons/${seasonId}/standings`);
}

export async function fetchSearch(q: string): Promise<SearchResults> {
  return apiFetch<SearchResults>(`/search?q=${encodeURIComponent(q)}`);
}

// ── Hooks ────────────────────────────────────────────────────────────────────

export function useCurrentMatches() {
  return useQuery({
    queryKey: qk.current,
    queryFn: fetchCurrentMatches,
    select: selectCurrentMatches,
    refetchInterval: 60_000, // respaldo de la home; el directo fino lo lleva el SSE
    staleTime: 30_000,
  });
}

export function useMatchDetail(id: string) {
  return useQuery({
    queryKey: qk.match(id),
    queryFn: () => apiFetch<MatchDetail>(`/matches/${id}`),
    staleTime: 5_000,
  });
}

export function useCompetitions() {
  return useQuery({
    queryKey: qk.competitions,
    queryFn: fetchCompetitions,
    select: selectCompetitions,
    staleTime: 10 * 60_000,
  });
}

export function useStandings(seasonId: string | undefined) {
  return useQuery({
    queryKey: qk.standings(seasonId ?? ''),
    queryFn: () => fetchStandings(seasonId ?? ''),
    enabled: standingsEnabled(seasonId),
    select: selectStandings,
    // Task 5.2: conserva la tabla anterior mientras carga el chip nuevo
    // (sin flash de vacío al cambiar de competición; la UI marca los datos
    // previos con isPlaceholderData).
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

export function useSearch(q: string) {
  const clean = q.trim();
  return useQuery({
    queryKey: qk.search(clean),
    queryFn: () => fetchSearch(clean),
    enabled: searchEnabled(clean),
    placeholderData: keepPreviousData,
  });
}

export function useFavorites(token: string | null | undefined) {
  return useQuery({
    queryKey: qk.favorites,
    queryFn: () => apiFetch<FavoritesResponse>('/auth/favorites', { token: token ?? undefined }),
    enabled: favoritesEnabled(token),
  });
}

/** Ficha de equipo (Task 2.5): estable → staleTime generoso. */
export function useTeam(id: string) {
  return useQuery({
    queryKey: qk.team(id),
    queryFn: () => apiFetch<TeamDetail>(`/teams/${id}`),
    enabled: Boolean(id),
    staleTime: 5 * 60_000,
  });
}

/** Ficha de jugador (Task 2.5): estable → staleTime generoso. */
export function usePlayer(id: string) {
  return useQuery({
    queryKey: qk.player(id),
    queryFn: () => apiFetch<PlayerDetail>(`/players/${id}`),
    enabled: Boolean(id),
    staleTime: 5 * 60_000,
  });
}

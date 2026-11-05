import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiFetch, ApiError } from '@/src/lib/api/client';
import { isAdfreeActive } from '@/src/lib/ads/adfree';
import type {
  AdsConfig,
  CompetitionSeasonsResponse,
  CompetitionSummary,
  CompetitionsResponse,
  CurrentMatchesResponse,
  FavoritesResponse,
  Federation,
  FederationsResponse,
  MatchDetailRaw,
  MatchSummary,
  PlayerDetail,
  PremiumStatus,
  SearchResults,
  SeasonOverview,
  SeasonStats,
  StandingsResponse,
  StandingsRow,
  TeamDetail,
} from '@/src/lib/api/types';
import { addDaysToKey } from '@/src/lib/day-view';

/**
 * Claves de query. Las consume la UI para invalidaciones puntuales
 * (p. ej. `qc.invalidateQueries({ queryKey: qk.favorites })`).
 */
export const qk = {
  current: ['matches', 'current'] as const,
  /** Partidos que salen por defecto (destacadas + lo seguido), spec 2026-10-30. */
  feed: (f: FeedFollows) => ['matches', 'current', 'feed', f.teams.join(','), f.leagues.join(',')] as const,
  /** Todo el catálogo de un día («Ver otras competiciones»). */
  dayAll: (dayKey: string) => ['matches', 'current', 'day', dayKey] as const,
  /** Solo lo seguido (Favoritos). */
  following: (f: FeedFollows) => ['matches', 'current', 'following', f.teams.join(','), f.leagues.join(',')] as const,
  match: (id: string) => ['matches', id] as const,
  competitions: ['competitions'] as const,
  federations: ['federations'] as const,
  competitionSeasons: (id: string) => ['competitions', id, 'seasons'] as const,
  seasonOverview: (seasonId: string) => ['seasons', seasonId, 'overview'] as const,
  seasonStats: (seasonId: string) => ['seasons', seasonId, 'stats'] as const,
  standings: (seasonId: string) => ['standings', seasonId] as const,
  search: (q: string) => ['search', q] as const,
  favorites: ['favorites'] as const,
  team: (id: string, seasonId?: string) => seasonId ? (['teams', id, seasonId] as const) : (['teams', id] as const),
  player: (id: string) => ['players', id] as const,
  premium: ['premium'] as const,
  adsConfig: ['adsConfig'] as const,
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

/**
 * Gating de publicidad (regla de dinero, fail-closed): premium SIEMPRE gana;
 * el ad-free recompensado (rewarded, Plan D) oculta los ads mientras esté
 * vigente; sin consentimiento UMP no hay ads; sin unit id configurado no hay
 * ads.
 *
 * premium === undefined (cargando o error con sesión) ⇒ fail-closed: un
 * premium no debe ver ni un frame de banner mientras se resuelve el estado.
 * Sin sesión el llamador pasa false explícito (el anónimo SÍ ve ads).
 * El hook de estado (usePremiumStatus, Task 2) debe devolver `undefined`
 * mientras carga o ante error CON sesión, y `false` solo sin sesión.
 *
 * adfreeUntil (Plan D Task 2) aplica a CUALQUIER no-premium: llega aquí tras
 * el check de premium, así que un premium nunca lo consulta (premium gana
 * siempre). Valor basura ⇒ isAdfreeActive hace fail-closed (ads visibles).
 *
 * Exportada para el test y para AdBanner (Task 4).
 */
export function shouldShowAds(gate: {
  premium: boolean | undefined;
  consentGranted: boolean;
  unitId: string | null | undefined;
  adfreeUntil: number | null | undefined;
}): boolean {
  if (gate.premium !== false) return false;
  // Ad-free recompensado (rewarded): minutos regalados sin anuncios.
  if (isAdfreeActive(Date.now(), gate.adfreeUntil)) return false;
  if (!gate.consentGranted) return false;
  return Boolean(gate.unitId);
}

/** `/matches/current` y `/matches/live` devuelven `{ count, matches }` (live.ts:240-241). */
export const selectCurrentMatches = (d: CurrentMatchesResponse): MatchSummary[] => d.matches;

/** `/competitions` devuelve `{ count, competitions }` (competitions.ts:121). */
export const selectCompetitions = (d: CompetitionsResponse): CompetitionSummary[] => d.competitions;

/** `/federations` devuelve `{ count, federations }` (federations.ts:58). */
export const selectFederations = (d: FederationsResponse): Federation[] => d.federations;

/** `/seasons/:id/standings` devuelve `{ seasonId, group, count, standings }` (standings.ts:40-45). */
export const selectStandings = (d: StandingsResponse): StandingsRow[] => d.standings;

// ── QueryFns (exportados para testearlos con fetchQuery + fetch stubeado) ───

export async function fetchCurrentMatches(): Promise<CurrentMatchesResponse> {
  return apiFetch<CurrentMatchesResponse>('/matches/current');
}

/** Lo que sigue el usuario: decide qué partidos salen por defecto. */
export interface FeedFollows {
  teams: readonly string[];
  leagues: readonly string[];
}

/** Query string de `scope=feed|following` (misma API que la web). */
export function feedQueryString(scope: 'feed' | 'following', f: FeedFollows): string {
  const parts = [`scope=${scope}`];
  if (f.teams.length) parts.push(`teams=${f.teams.map(encodeURIComponent).join(',')}`);
  if (f.leagues.length) parts.push(`leagues=${f.leagues.map(encodeURIComponent).join(',')}`);
  return parts.join('&');
}

export async function fetchFeedMatches(f: FeedFollows): Promise<CurrentMatchesResponse> {
  return apiFetch<CurrentMatchesResponse>(`/matches/current?${feedQueryString('feed', f)}`);
}

export async function fetchFollowingMatches(f: FeedFollows): Promise<CurrentMatchesResponse> {
  if (!f.teams.length && !f.leagues.length) return { count: 0, matches: [] };
  return apiFetch<CurrentMatchesResponse>(`/matches/current?${feedQueryString('following', f)}`);
}

/** Todo un día de Madrid, con un día de margen a cada lado (la vista vuelve a filtrar). */
export async function fetchDayMatches(dayKey: string): Promise<CurrentMatchesResponse> {
  const from = addDaysToKey(dayKey, -1);
  const to = addDaysToKey(dayKey, 1);
  return apiFetch<CurrentMatchesResponse>(`/matches/current?from=${from}&to=${to}`);
}

export async function fetchCompetitions(): Promise<CompetitionsResponse> {
  return apiFetch<CompetitionsResponse>('/competitions');
}

export async function fetchFederations(): Promise<FederationsResponse> {
  return apiFetch<FederationsResponse>('/federations');
}

export async function fetchCompetitionSeasons(competitionId: string): Promise<CompetitionSeasonsResponse> {
  return apiFetch<CompetitionSeasonsResponse>(`/competitions/${competitionId}/seasons`);
}

export async function fetchSeasonOverview(seasonId: string): Promise<SeasonOverview> {
  return apiFetch<SeasonOverview>(`/seasons/${seasonId}/overview`);
}

export async function fetchSeasonStats(seasonId: string): Promise<SeasonStats> {
  try {
    return await apiFetch<SeasonStats>(`/seasons/${seasonId}/stats`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return { topScorers: [], topAssists: [], topCards: [] };
    }
    throw err;
  }
}

export async function fetchStandings(seasonId: string): Promise<StandingsResponse> {
  try {
    return await apiFetch<StandingsResponse>(`/seasons/${seasonId}/standings`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return { seasonId, group: null, count: 0, standings: [] };
    }
    throw err;
  }
}

export async function fetchSearch(q: string): Promise<SearchResults> {
  return apiFetch<SearchResults>(`/search?q=${encodeURIComponent(q)}`);
}

/** Estado premium de la SESIÓN (Task 1): la compra es SOLO en la web. */
export async function fetchPremiumStatus(token: string): Promise<PremiumStatus> {
  return apiFetch<PremiumStatus>('/payments/status', { token });
}

/**
 * Config remota de ads (Plan D): PÚBLICA — sin token, responde igual con o
 * sin sesión. La consumen los guards de cada formato (Tasks 2-6).
 */
export async function fetchAdsConfig(): Promise<AdsConfig> {
  return apiFetch<AdsConfig>('/ads/config');
}

// ── Hooks ────────────────────────────────────────────────────────────────────

/**
 * Config remota de ads como query (Plan D): pública, sin sesión y estable —
 * staleTime largo (gobierna la EXISTENCIA de los formatos: cambia por
 * redeploy del API, no en cada navegación). Sin datos (`undefined`) los
 * consumidores fail-closed ocultan el formato (RewardedCard, native in-feed).
 */
export function useAdsConfig() {
  return useQuery({
    queryKey: qk.adsConfig,
    queryFn: fetchAdsConfig,
    staleTime: 15 * 60_000,
  });
}

/** Home: destacadas + lo seguido (spec 2026-10-30). Antes, todo el catálogo (~3 MB). */
export function useFeedMatches(f: FeedFollows) {
  return useQuery({
    queryKey: qk.feed(f),
    queryFn: () => fetchFeedMatches(f),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

/** «Ver otras competiciones»: el día entero, solo cuando el usuario lo pide. */
export function useDayMatches(dayKey: string, enabled: boolean) {
  return useQuery({
    queryKey: qk.dayAll(dayKey),
    queryFn: () => fetchDayMatches(dayKey),
    select: selectCurrentMatches,
    enabled,
    staleTime: 60_000,
  });
}

/** Favoritos (Mi grada): solo lo seguido. */
export function useFollowingMatches(f: FeedFollows) {
  return useQuery({
    queryKey: qk.following(f),
    queryFn: () => fetchFollowingMatches(f),
    select: selectCurrentMatches,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

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
    queryFn: () => apiFetch<MatchDetailRaw>(`/matches/${id}`),
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

export function useFederations() {
  return useQuery({
    queryKey: qk.federations,
    queryFn: fetchFederations,
    select: selectFederations,
    staleTime: 60 * 60_000,
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

/** Ficha de equipo (Task 2.5): estable → staleTime generoso. Soporta filtrar por ?season=. */
export function useTeam(id: string, seasonId?: string) {
  const query = seasonId ? `?season=${seasonId}` : '';
  return useQuery({
    queryKey: qk.team(id, seasonId),
    queryFn: () => apiFetch<TeamDetail>(`/teams/${id}${query}`),
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

/** Temporadas de una competición (histórico). */
export function useCompetitionSeasons(competitionId: string | undefined) {
  return useQuery({
    queryKey: qk.competitionSeasons(competitionId ?? ''),
    queryFn: () => fetchCompetitionSeasons(competitionId ?? ''),
    enabled: Boolean(competitionId),
    staleTime: 30 * 60_000,
  });
}

/** Overview completo de una temporada (metadatos, clasificación, partidos y rondas). */
export function useSeasonOverview(seasonId: string | undefined) {
  return useQuery({
    queryKey: qk.seasonOverview(seasonId ?? ''),
    queryFn: () => fetchSeasonOverview(seasonId ?? ''),
    enabled: Boolean(seasonId),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

/** Líderes estadísticos de una temporada (goleadores, asistencias, tarjetas). */
export function useSeasonStats(seasonId: string | undefined) {
  return useQuery({
    queryKey: qk.seasonStats(seasonId ?? ''),
    queryFn: () => fetchSeasonStats(seasonId ?? ''),
    enabled: Boolean(seasonId),
    staleTime: 5 * 60_000,
  });
}

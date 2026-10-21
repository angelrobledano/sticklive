import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/src/lib/api/client';
import { isAdfreeActive } from '@/src/lib/ads/adfree';
import type {
  AdsConfig,
  CompetitionSeasonsResponse,
  CompetitionSummary,
  CompetitionsResponse,
  CurrentMatchesResponse,
  FavoritesResponse,
  MatchDetail,
  MatchSummary,
  PlayerDetail,
  PremiumStatus,
  SearchResults,
  SeasonOverview,
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
  competitionSeasons: (id: string) => ['competitions', id, 'seasons'] as const,
  seasonOverview: (seasonId: string) => ['seasons', seasonId, 'overview'] as const,
  standings: (seasonId: string) => ['standings', seasonId] as const,
  search: (q: string) => ['search', q] as const,
  favorites: ['favorites'] as const,
  team: (id: string) => ['teams', id] as const,
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

/** `/seasons/:id/standings` devuelve `{ seasonId, group, count, standings }` (standings.ts:40-45). */
export const selectStandings = (d: StandingsResponse): StandingsRow[] => d.standings;

// ── QueryFns (exportados para testearlos con fetchQuery + fetch stubeado) ───

export async function fetchCurrentMatches(): Promise<CurrentMatchesResponse> {
  return apiFetch<CurrentMatchesResponse>('/matches/current');
}

export async function fetchCompetitions(): Promise<CompetitionsResponse> {
  return apiFetch<CompetitionsResponse>('/competitions');
}

export async function fetchCompetitionSeasons(competitionId: string): Promise<CompetitionSeasonsResponse> {
  return apiFetch<CompetitionSeasonsResponse>(`/competitions/${competitionId}/seasons`);
}

export async function fetchSeasonOverview(seasonId: string): Promise<SeasonOverview> {
  return apiFetch<SeasonOverview>(`/seasons/${seasonId}/overview`);
}

export async function fetchStandings(seasonId: string): Promise<StandingsResponse> {
  return apiFetch<StandingsResponse>(`/seasons/${seasonId}/standings`);
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

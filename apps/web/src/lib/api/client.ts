/**
 * API Client — fetchers tipados hacia apps/api (Hono).
 *
 * Barrel público de la capa API: los tipos viven en `./types` y el fetch en
 * `./core`. Este módulo define los fetchers + el mapeo crudo→DTO, y re-exporta
 * tipos y helpers para no romper los imports existentes de `@/lib/api/client`.
 */
import { apiFetch } from './core';
import type {
  Match,
  MatchScore,
  MatchVenue,
  MatchStatus,
  TeamSummary,
  PenaltyKick,
  StandingItem,
  HealthResponse,
  GetMatchesFilters,
  MatchDetail,
  MatchLiveState,
  MatchEvent,
  MatchStats,
  MatchLineups,
  CompetitionSummary,
  CompetitionSeason,
  SeasonStats,
  TeamDetail,
  SeasonOverview,
  PlayerDetail,
} from './types';

export { isApiNotFound } from './core';
export * from './types';

// ─── Mapeo crudo→DTO ───
// Las respuestas de listas vienen en snake_case; las normalizamos al DTO camelCase.

interface RawMatch {
  id: string;
  season_id: string;
  round_id: string | null;
  status: MatchStatus;
  scheduled_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  home_score: number | null;
  away_score: number | null;
  venue_name: string | null;
  venue_city: string | null;
  home_team_id: string;
  home_team_name: string | null;
  home_team_short_name: string | null;
  home_team_logo_url: string | null;
  away_team_id: string;
  away_team_name: string | null;
  away_team_short_name: string | null;
  away_team_logo_url: string | null;
  source_ref: string | null;
}

interface RawLiveMatch {
  id: string;
  seasonId: string;
  roundId: string | null;
  competitionId?: string | null;
  competitionName?: string | null;
  competitionSlug?: string | null;
  competitionTimezone?: string | null;
  competitionCountry?: string | null;
  status: MatchStatus;
  isHalftime?: boolean;
  winType?: 'regular' | 'overtime' | 'penalties' | null;
  winnerTeamId?: string | null;
  penalties?: MatchScore | null;
  scheduledAt: string | null;
  startedAt: string | null;
  score: MatchScore;
  venue: MatchVenue | null;
  homeTeam: TeamSummary;
  awayTeam: TeamSummary;
}

interface RawStanding {
  id: string;
  season_id: string;
  team_id: string;
  group_name: string | null;
  position: number | null;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goals_for: number;
  goals_against: number;
  goal_diff: number;
  points: number;
  form: string[] | null;
}

function normalizeMatch(raw: RawMatch): Match {
  return {
    id:          raw.id,
    seasonId:    raw.season_id,
    roundId:     raw.round_id,
    status:      raw.status,
    scheduledAt: raw.scheduled_at,
    startedAt:   raw.started_at,
    finishedAt:  raw.finished_at,
    score:       { home: raw.home_score, away: raw.away_score },
    venue:       raw.venue_name ? { name: raw.venue_name, city: raw.venue_city } : null,
    homeTeamId:  raw.home_team_id,
    awayTeamId:  raw.away_team_id,
    homeTeam: {
      id:        raw.home_team_id,
      name:      raw.home_team_name ?? raw.home_team_id,
      shortName: raw.home_team_short_name,
      logoUrl:   raw.home_team_logo_url,
    },
    awayTeam: {
      id:        raw.away_team_id,
      name:      raw.away_team_name ?? raw.away_team_id,
      shortName: raw.away_team_short_name,
      logoUrl:   raw.away_team_logo_url,
    },
    sourceRef:   raw.source_ref,
  };
}

function normalizeLiveMatch(raw: RawLiveMatch): Match {
  return {
    id:          raw.id,
    seasonId:    raw.seasonId,
    roundId:     raw.roundId,
    competitionId:   raw.competitionId ?? null,
    competitionName: raw.competitionName ?? null,
    competitionSlug: raw.competitionSlug ?? null,
    competitionTimezone: raw.competitionTimezone ?? null,
    competitionCountry:  raw.competitionCountry ?? null,
    status:      raw.status,
    isHalftime:  raw.isHalftime ?? false,
    winType:      raw.winType ?? null,
    winnerTeamId: raw.winnerTeamId ?? null,
    penalties:    raw.penalties ?? null,
    scheduledAt: raw.scheduledAt,
    startedAt:   raw.startedAt,
    finishedAt:  null,
    score:       raw.score,
    venue:       raw.venue,
    homeTeamId:  raw.homeTeam.id,
    awayTeamId:  raw.awayTeam.id,
    homeTeam:    raw.homeTeam,
    awayTeam:    raw.awayTeam,
    sourceRef:   null,
  };
}

function normalizeStanding(raw: RawStanding): StandingItem {
  return {
    id:           raw.id,
    seasonId:     raw.season_id,
    teamId:       raw.team_id,
    groupName:    raw.group_name,
    position:     raw.position,
    played:       raw.played,
    won:          raw.won,
    drawn:        raw.drawn,
    lost:         raw.lost,
    goalsFor:     raw.goals_for,
    goalsAgainst: raw.goals_against,
    goalDiff:     raw.goal_diff,
    points:       raw.points,
    form:         raw.form,
  };
}

function deduplicateMatches(matches: Match[]): Match[] {
  const seen = new Map<string, Match>();
  for (const match of matches) {
    // Incluir la fecha (día) en la clave para que los partidos del mismo
    // enfrentamiento en días distintos NO se fusionen (caso playoff, donde
    // los mismos equipos juegan 2-3 veces en una serie).
    // Solo se fusionan duplicados del mismo día (calendar + live scraper).
    const dateKey = match.scheduledAt?.slice(0, 10) ?? 'nodate';
    const key = `${match.homeTeamId}:${match.awayTeamId}:${dateKey}`;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, match);
      continue;
    }
    const existingDate = existing.scheduledAt ? new Date(existing.scheduledAt).getTime() : 0;
    const incomingDate = match.scheduledAt    ? new Date(match.scheduledAt).getTime()    : 0;
    if (incomingDate > existingDate) {
      seen.set(key, match);
    }
  }
  return Array.from(seen.values());
}

// ─── Health ───

export function getHealth(): Promise<HealthResponse> {
  return apiFetch<HealthResponse>('/health', { next: { revalidate: 30 } });
}

// ─── Standings ───

export async function getStandings(
  seasonId: string,
  group?: string
): Promise<StandingItem[]> {
  const qs = group ? `?group=${encodeURIComponent(group)}` : '';
  const res = await apiFetch<{ standings: RawStanding[] }>(
    `/seasons/${seasonId}/standings${qs}`,
    { next: { revalidate: 300, tags: [`standings-${seasonId}`] } }
  );
  return res.standings.map(normalizeStanding);
}

// ─── Matches (listas) ───

export async function getMatches(
  seasonId: string,
  filters?: GetMatchesFilters
): Promise<Match[]> {
  const qs = new URLSearchParams();
  if (filters?.gameweek !== undefined) qs.set('gameweek', String(filters.gameweek));
  if (filters?.status   !== undefined) qs.set('status', filters.status);
  if (filters?.teamId   !== undefined) qs.set('teamId', filters.teamId);
  const query = qs.toString() ? `?${qs.toString()}` : '';
  const res = await apiFetch<{ matches: RawMatch[] }>(
    `/seasons/${seasonId}/matches${query}`,
    { next: { revalidate: 60, tags: [`matches-${seasonId}`] } }
  );
  const normalized = res.matches.map(normalizeMatch);
  return filters?.gameweek !== undefined ? normalized : deduplicateMatches(normalized);
}

export async function getLiveMatches(): Promise<Match[]> {
  const res = await apiFetch<{ matches: RawLiveMatch[] }>('/matches/live', {
    cache: 'no-store',
  });
  return res.matches.map(normalizeLiveMatch);
}

/**
 * Partidos de TODAS las temporadas is_current=true.
 * Usado en la home page para mostrar competiciones activas en paralelo
 * (liga regular + playoffs + otras competiciones en curso).
 */
export async function getCurrentMatches(): Promise<Match[]> {
  const res = await apiFetch<{ matches: RawLiveMatch[] }>('/matches/current', {
    next: { revalidate: 60, tags: ['matches-current'] },
  });
  return deduplicateMatches(res.matches.map(normalizeLiveMatch));
}

/**
 * Igual que getCurrentMatches pero SIN caché — para el refresco en vivo desde el
 * cliente. La home se renderiza en el servidor con revalidate:60, pero un usuario
 * mirando la lista no genera nuevas requests, así que el marcador se congela. Este
 * fetcher (cache:'no-store') lo usa el hook useLiveScores para sondear mientras
 * haya partidos en juego y reflejar marcador/estado en tiempo real.
 */
export async function getCurrentMatchesFresh(): Promise<Match[]> {
  const res = await apiFetch<{ matches: RawLiveMatch[] }>('/matches/current', {
    cache: 'no-store',
  });
  return deduplicateMatches(res.matches.map(normalizeLiveMatch));
}

// ─── Match detail ───

interface RawMatchDetail {
  match: {
    id: string;
    seasonId: string;
    roundId: string | null;
    competitionId?: string | null;
    competitionName?: string | null;
    competitionSlug?: string | null;
    status: MatchStatus;
    eventCoverage: 'full' | 'partial' | 'none';
    scheduledAt: string | null;
    startedAt: string | null;
    finishedAt: string | null;
    score: MatchScore;
    winType?: 'regular' | 'overtime' | 'penalties' | null;
    winnerTeamId?: string | null;
    regulation?: MatchScore | null;
    penalties?: MatchScore | null;
    penaltyShootout?: { home: PenaltyKick[]; away: PenaltyKick[] } | null;
    venue: MatchVenue | null;
    referee: string | null;
    sourceRef: string | null;
    videoUrl?: string | null;
    live?: MatchLiveState | null;
    homeTeam: TeamSummary;
    awayTeam: TeamSummary;
  };
  events: MatchEvent[];
  stats: MatchStats;
  lineups?: MatchLineups;
}

export async function getMatchDetail(matchId: string): Promise<MatchDetail> {
  const raw = await apiFetch<RawMatchDetail>(`/matches/${matchId}`, {
    next: { revalidate: 20, tags: [`match-${matchId}`] },
  });
  return {
    match: {
      id:          raw.match.id,
      seasonId:    raw.match.seasonId,
      roundId:     raw.match.roundId,
      competitionId:   raw.match.competitionId ?? null,
      competitionName: raw.match.competitionName ?? null,
      competitionSlug: raw.match.competitionSlug ?? null,
      status:      raw.match.status,
      eventCoverage: raw.match.eventCoverage,
      scheduledAt: raw.match.scheduledAt,
      startedAt:   raw.match.startedAt,
      finishedAt:  raw.match.finishedAt,
      score:       raw.match.score,
      winType:      raw.match.winType ?? null,
      winnerTeamId: raw.match.winnerTeamId ?? null,
      regulation:   raw.match.regulation ?? null,
      penalties:    raw.match.penalties ?? null,
      penaltyShootout: raw.match.penaltyShootout ?? null,
      venue:       raw.match.venue,
      referee:     raw.match.referee,
      homeTeamId:  raw.match.homeTeam.id,
      awayTeamId:  raw.match.awayTeam.id,
      homeTeam:    raw.match.homeTeam,
      awayTeam:    raw.match.awayTeam,
      sourceRef:   raw.match.sourceRef,
      videoUrl:    raw.match.videoUrl ?? null,
      live:        raw.match.live ?? null,
    },
    events: raw.events,
    stats:  raw.stats,
    lineups: raw.lineups ?? { home: [], away: [] },
  };
}

// ─── Competitions ───

export async function getCompetitions(): Promise<CompetitionSummary[]> {
  const res = await apiFetch<{ competitions: CompetitionSummary[] }>(
    '/competitions',
    { next: { revalidate: 300, tags: ['competitions'] } }
  );
  return res.competitions;
}

export async function getCompetitionSeasons(competitionId: string): Promise<CompetitionSeason[]> {
  const res = await apiFetch<{ seasons: CompetitionSeason[] }>(
    `/competitions/${competitionId}/seasons`,
    { next: { revalidate: 300, tags: [`competition-${competitionId}`] } }
  );
  return res.seasons;
}

export async function getSeasonStats(seasonId: string): Promise<SeasonStats> {
  return apiFetch<SeasonStats>(`/seasons/${seasonId}/stats`, {
    next: { revalidate: 120, tags: [`season-stats-${seasonId}`] },
  });
}

// ─── Team detail ───

export async function getTeamDetail(teamId: string, seasonId?: string | null): Promise<TeamDetail> {
  const qs = seasonId ? `?season=${encodeURIComponent(seasonId)}` : '';
  return apiFetch<TeamDetail>(`/teams/${teamId}${qs}`, {
    next: { revalidate: 120, tags: [`team-${teamId}`] },
  });
}

// ─── Season overview (Competition Center) ───

export async function getSeasonOverview(seasonId: string): Promise<SeasonOverview> {
  return apiFetch<SeasonOverview>(`/seasons/${seasonId}/overview`, {
    next: { revalidate: 120, tags: [`season-${seasonId}`] },
  });
}

// ─── Player detail ───

export async function getPlayerDetail(playerId: string): Promise<PlayerDetail> {
  return apiFetch<PlayerDetail>(`/players/${playerId}`, {
    next: { revalidate: 120, tags: [`player-${playerId}`] },
  });
}

/**
 * API Client — fetchers tipados hacia apps/api (Hono).
 */

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000';

async function apiFetch<T>(
  path: string,
  init?: RequestInit & { next?: { revalidate?: number; tags?: string[] } }
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status} - ${path}: ${body}`);
  }
  return res.json() as Promise<T>;
}

/**
 * True solo si la API respondió 404 de verdad (recurso inexistente).
 * Un fallo de conexión o un 500 NO es un 404: las páginas deben mostrar
 * su error boundary (con reintento) en vez de "no encontrado" — si no,
 * cada reinicio de la API convertía páginas válidas en 404s intermitentes.
 */
export function isApiNotFound(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith('API 404');
}

export interface TeamSummary {
  id: string;
  name: string;
  shortName: string | null;
  logoUrl: string | null;
}

export interface MatchScore {
  home: number | null;
  away: number | null;
}

export interface MatchVenue {
  name: string;
  city: string | null;
}

export type MatchStatus =
  | 'scheduled'
  | 'live'
  | 'finished'
  | 'postponed'
  | 'cancelled';

export interface Match {
  id: string;
  seasonId: string;
  roundId: string | null;
  status: MatchStatus;
  scheduledAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  score: MatchScore;
  venue: MatchVenue | null;
  homeTeamId: string;
  awayTeamId: string;
  homeTeam?: TeamSummary;
  awayTeam?: TeamSummary;
  sourceRef: string | null;
}

export interface StandingItem {
  id: string;
  seasonId: string;
  teamId: string;
  groupName: string | null;
  position: number | null;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  points: number;
  form: string[] | null;
  penalizationPoints?: number;
}

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
  status: MatchStatus;
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
    status:      raw.status,
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

export interface HealthResponse {
  status: string;
  timestamp: string;
}

export function getHealth(): Promise<HealthResponse> {
  return apiFetch<HealthResponse>('/health', { next: { revalidate: 30 } });
}

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

export interface GetMatchesFilters {
  gameweek?: number;
  status?: MatchStatus | string;
  teamId?: string;
}

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

// ============================================================
// MATCH DETAIL
// ============================================================

export type MatchEventType =
  | 'goal'
  | 'penalty'
  | 'blue_card'
  | 'red_card'
  | 'timeout'
  | 'period_end'
  | 'foul'
  | 'direct_foul';

export interface MatchEvent {
  id: string;
  eventType: MatchEventType;
  minute: number | null;
  period: number | null;
  /** Tiempo RESTANTE del crono al ocurrir el evento ("MM:SS", cuenta atrás) */
  clock?: string | null;
  teamId: string | null;
  isHomeTeam: boolean;
  detail: string | null;
  player: { id: string; firstName: string; lastName: string } | null;
}

export interface MatchStats {
  homeFouls: number;
  awayFouls: number;
  homeGoals?: number;
  awayGoals?: number;
  homeAssists?: number;
  awayAssists?: number;
  homeBlueCards?: number;
  awayBlueCards?: number;
  homeRedCards?: number;
  awayRedCards?: number;
  homeTimeouts?: number;
  awayTimeouts?: number;
  homeDirectFouls?: { total: number; scored: number };
  awayDirectFouls?: { total: number; scored: number };
  homePenalties: { total: number; scored: number };
  awayPenalties: { total: number; scored: number };
}

export interface CompetitionSummary {
  id: string;
  name: string;
  shortName: string | null;
  slug: string;
  gender: string | null;
  category: string | null;
  country: string | null;
  organizer: string;
  scope: 'national' | 'regional' | 'international';
  region: string | null;
  ageCategory: string;
  season: {
    id: string;
    name: string | null;
    startDate?: string | null;
    endDate?: string | null;
    isCurrent: boolean;
    teamCount: number;
    matchCount: number;
  } | null;
}

export async function getCompetitions(): Promise<CompetitionSummary[]> {
  const res = await apiFetch<{ competitions: CompetitionSummary[] }>(
    '/competitions',
    { next: { revalidate: 300, tags: ['competitions'] } }
  );
  return res.competitions;
}

export interface CompetitionSeason {
  id: string;
  name: string;
  slug: string;
  isCurrent: boolean;
}

export async function getCompetitionSeasons(competitionId: string): Promise<CompetitionSeason[]> {
  const res = await apiFetch<{ seasons: CompetitionSeason[] }>(
    `/competitions/${competitionId}/seasons`,
    { next: { revalidate: 300, tags: [`competition-${competitionId}`] } }
  );
  return res.seasons;
}

export interface SeasonLeader {
  playerId: string | null;
  playerName: string;
  photoUrl?: string | null;
  teamId: string | null;
  teamShort: string | null;
  teamName: string | null;
  value: number;
  extra: number;
}

export interface TeamSetPieces {
  teamId: string;
  teamShort: string | null;
  teamName: string | null;
  directFouls: { total: number; scored: number; pct: number | null };
  penalties: { total: number; scored: number; pct: number | null };
}

export interface SeasonStats {
  topScorers: SeasonLeader[];
  topAssists: SeasonLeader[];
  topCards: SeasonLeader[];
  setPieces?: TeamSetPieces[];
}

export async function getSeasonStats(seasonId: string): Promise<SeasonStats> {
  return apiFetch<SeasonStats>(`/seasons/${seasonId}/stats`, {
    next: { revalidate: 120, tags: [`season-stats-${seasonId}`] },
  });
}

export interface LineupPlayer {
  jerseyNumber: number | null;
  playerName: string;
  playerId?: string | null;
  isGoalkeeper: boolean;
  isStarter: boolean;
  isCaptain: boolean;
  goals: number;
  assists?: number;
  photoUrl?: string | null;
}

export interface MatchLineups {
  home: LineupPlayer[];
  away: LineupPlayer[];
}

export interface MatchDetail {
  match: Match & { referee: string | null };
  events: MatchEvent[];
  stats: MatchStats;
  lineups: MatchLineups;
}

interface RawMatchDetail {
  match: {
    id: string;
    seasonId: string;
    roundId: string | null;
    status: MatchStatus;
    scheduledAt: string | null;
    startedAt: string | null;
    finishedAt: string | null;
    score: MatchScore;
    venue: MatchVenue | null;
    referee: string | null;
    sourceRef: string | null;
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
      status:      raw.match.status,
      scheduledAt: raw.match.scheduledAt,
      startedAt:   raw.match.startedAt,
      finishedAt:  raw.match.finishedAt,
      score:       raw.match.score,
      venue:       raw.match.venue,
      referee:     raw.match.referee,
      homeTeamId:  raw.match.homeTeam.id,
      awayTeamId:  raw.match.awayTeam.id,
      homeTeam:    raw.match.homeTeam,
      awayTeam:    raw.match.awayTeam,
      sourceRef:   raw.match.sourceRef,
    },
    events: raw.events,
    stats:  raw.stats,
    lineups: raw.lineups ?? { home: [], away: [] },
  };
}

// ============================================================
// TEAM DETAIL
// ============================================================

export interface TeamStanding {
  seasonId: string;
  competitionId: string;
  competitionName: string;
  competitionShort: string | null;
  position: number | null;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  points: number;
  form: string[];
  penalizationPoints: number;
}

export interface TeamMatchSummary {
  id: string;
  status: string;
  scheduledAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  score: MatchScore;
  venue: MatchVenue | null;
  homeTeam: TeamSummary;
  awayTeam: TeamSummary;
}

export interface SquadPlayer {
  playerId: string;
  firstName: string;
  lastName: string;
  position: string | null;
  photoUrl?: string | null;
  jerseyNumber: number | null;
  goals: number;
  blueCards: number;
  redCards: number;
  penalties: number;
}

export interface TeamDetail {
  team: {
    id: string;
    name: string;
    shortName: string | null;
    city: string | null;
    country: string;
    logoUrl: string | null;
    websiteUrl: string | null;
  };
  standing: TeamStanding | null;
  matches: TeamMatchSummary[];
  squad: SquadPlayer[];
  staff?: TeamStaffMember[];
  stats?: TeamSeasonStats | null;
}

export interface TeamStaffMember {
  name: string;
  role: string; // E1/E2/A/D
}

export interface TeamSeasonStats {
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  assists: number;
  teamFouls: number;
  blueCards: number;
  redCards: number;
  timeouts: number;
  directFouls: { total: number; scored: number; pct: number | null };
  penalties: { total: number; scored: number; pct: number | null };
}

export async function getTeamDetail(teamId: string): Promise<TeamDetail> {
  return apiFetch<TeamDetail>(`/teams/${teamId}`, {
    next: { revalidate: 120, tags: [`team-${teamId}`] },
  });
}

// ============================================================
// SEASON OVERVIEW (Competition Center)
// ============================================================

export interface SeasonStandingRow {
  id: string;
  teamId: string;
  teamName: string;
  teamShortName: string | null;
  teamLogoUrl: string | null;
  groupName: string | null;
  position: number | null;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  points: number;
  form: string[];
  penalizationPoints: number;
}

export interface SeasonRound {
  id: string;
  number: number;
  name: string | null;
  roundType: 'regular' | 'playoff' | 'cup' | 'friendly';
}

export interface SeasonMatch {
  id: string;
  status: string;
  scheduledAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  score: MatchScore;
  venueName: string | null;
  roundId: string | null;
  roundNumber: number | null;
  roundName: string | null;
  roundType: string;
  homeTeam: TeamSummary;
  awayTeam: TeamSummary;
}

export interface SeasonOverview {
  season: {
    id: string;
    name: string;
    startDate: string | null;
    endDate: string | null;
    competitionId: string;
    competitionName: string;
    competitionShort: string | null;
    competitionOrganizer: string;
    competitionScope: string;
    competitionCountry: string | null;
    competitionRegion: string | null;
  };
  standings: SeasonStandingRow[];
  rounds: SeasonRound[];
  matches: SeasonMatch[];
}

export async function getSeasonOverview(seasonId: string): Promise<SeasonOverview> {
  return apiFetch<SeasonOverview>(`/seasons/${seasonId}/overview`, {
    next: { revalidate: 120, tags: [`season-${seasonId}`] },
  });
}

// ============================================================
// PLAYER DETAIL
// ============================================================

export interface PlayerSeasonTotals {
  pj: number;
  goals: number;
  blueCards: number;
  redCards: number;
  penaltiesTotal: number;
  penaltiesScored: number;
}

export interface PlayerCompStats {
  competitionId: string;
  competitionName: string;
  competitionShort: string | null;
  pj: number;
  goals: number;
  blueCards: number;
  redCards: number;
  penaltiesTotal: number;
  penaltiesScored: number;
}

export interface PlayerDetail {
  player: {
    id: string;
    firstName: string;
    lastName: string;
    birthDate: string | null;
    nationality: string | null;
    position: string | null;
    sourceRef: string | null;
    photoUrl?: string | null;
  };
  currentTeam: {
    id: string;
    name: string;
    shortName: string | null;
    logoUrl: string | null;
    jerseyNumber: number | null;
    seasonId: string;
  } | null;
  seasonTotals: PlayerSeasonTotals;
  statsByCompetition: PlayerCompStats[];
}

export async function getPlayerDetail(playerId: string): Promise<PlayerDetail> {
  return apiFetch<PlayerDetail>(`/players/${playerId}`, {
    next: { revalidate: 120, tags: [`player-${playerId}`] },
  });
}

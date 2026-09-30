/**
 * Tipos de la capa API del frontend (DTOs de respuesta de apps/api).
 *
 * IMPORTANTE — no confundir con `@sports/shared-types`: aquellos son el modelo de
 * DOMINIO/BD (p. ej. `Match` con `homeTeamId`/`homeScore`). Estos describen la
 * RESPUESTA JSON que sirve la API (p. ej. `Match` con `homeTeam` anidado y
 * `score`). Son tipos distintos a propósito; no deben unificarse.
 */

// ─── Comunes a varios dominios ───

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

export interface PenaltyKick {
  player: string;
  scored: boolean;
}

export interface MatchVenue {
  name: string;
  city: string | null;
}

/**
 * Estado de partido EXPUESTO POR LA API (más estrecho que el `MatchStatus` de
 * dominio en `@sports/shared-types`): la API coacciona `halftime/overtime/
 * penalty_shootout` a `'live'` y comunica ese matiz por separado (`isHalftime`,
 * `winType`). Por eso aquí no aparecen esos tres estados — es intencional.
 */
export type MatchStatus =
  | 'scheduled'
  | 'live'
  | 'finished'
  | 'postponed'
  | 'cancelled';

export interface Match {
  /** Cobertura de eventos: 'none' = solo marcador (partido histórico). */
  eventCoverage?: 'full' | 'partial' | 'none';
  id: string;
  seasonId: string;
  roundId: string | null;
  competitionId?: string | null;
  competitionName?: string | null;
  /** Slug de la competición: el listado del día ordena los bloques por importancia con él. */
  competitionSlug?: string | null;
  /** IANA TZ de la competición (ver migración 042). La web cae a Europe/Madrid. */
  competitionTimezone?: string | null;
  status: MatchStatus;
  /** Solo en directo: true durante el descanso (para badge "Descanso" en listas). */
  isHalftime?: boolean;
  scheduledAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  score: MatchScore;
  /** Prórroga/penaltis (null en partidos normales). `score` es el marcador mostrado. */
  winType?: 'regular' | 'overtime' | 'penalties' | null;
  winnerTeamId?: string | null;
  regulation?: MatchScore | null;
  penalties?: MatchScore | null;
  /** Desglose de la tanda: cada lanzamiento con jugador y si marcó. */
  penaltyShootout?: { home: PenaltyKick[]; away: PenaltyKick[] } | null;
  venue: MatchVenue | null;
  homeTeamId: string;
  awayTeamId: string;
  homeTeam?: TeamSummary;
  awayTeam?: TeamSummary;
  sourceRef: string | null;
  videoUrl?: string | null;
}

// ─── Health ───

export interface HealthResponse {
  status: string;
  timestamp: string;
}

// ─── Standings ───

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

// ─── Matches (listas) ───

export interface GetMatchesFilters {
  gameweek?: number;
  status?: MatchStatus | string;
  teamId?: string;
}

// ─── Match detail ───

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

export interface MatchLiveState {
  period: number | null;        // periodo en curso (1, 2…)
  clockSeconds: number | null;  // tiempo RESTANTE del periodo, en segundos
  clockAt: string | null;       // ISO: instante de captura (ancla para el tick)
  isHalftime: boolean;          // true durante el descanso
}

export interface MatchDetail {
  match: Match & { referee: string | null; live?: MatchLiveState | null };
  events: MatchEvent[];
  stats: MatchStats;
  lineups: MatchLineups;
}

// ─── Competitions ───

export interface CompetitionSummary {
  id: string;
  name: string;
  /** Traducciones del nombre por locale; la web cae a `name`. Ver migración 038. */
  nameI18n?: Record<string, string> | null;
  shortName: string | null;
  slug: string;
  gender: string | null;
  category: string | null;
  country: string | null;
  organizer: string;
  scope: 'national' | 'regional' | 'international';
  region: string | null;
  ageCategory: string;
  /** Calidad del histórico (#230): 'ok' | 'en_revision' — la web etiqueta (no oculta). */
  dataQuality?: 'ok' | 'en_revision' | string;
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

export interface CompetitionSeason {
  id: string;
  name: string;
  slug: string;
  isCurrent: boolean;
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

// ─── Team detail ───

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
  /** IANA TZ de la competición (migración 042). La web cae a Europe/Madrid. */
  competitionTimezone?: string | null;
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
  /** Derivado de match_lineups.is_goalkeeper (ver migración 039). */
  isGoalkeeper: boolean;
  photoUrl?: string | null;
  jerseyNumber: number | null;
  goals: number;
  blueCards: number;
  redCards: number;
  penalties: number;
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

export interface TeamClub {
  id: string;
  canonicalName: string;
  slug: string;
  crestUrl: string | null;
  city: string | null;
  country: string;
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
    // Club canónico (Fase 0.3). NULL hasta que el backfill 0.2 corra en prod.
    club: TeamClub | null;
  };
  standing: TeamStanding | null;
  matches: TeamMatchSummary[];
  squad: SquadPlayer[];
  staff?: TeamStaffMember[];
  stats?: TeamSeasonStats | null;
}

// ─── Season overview (Competition Center) ───

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
  /** IANA TZ de la competición (migración 042). La web cae a Europe/Madrid. */
  competitionTimezone?: string | null;
  scheduledAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  score: MatchScore;
  /** Ganador explícito (eliminatorias resueltas en penaltis); null si no aplica. */
  winnerTeamId?: string | null;
  winType?: 'regular' | 'overtime' | 'penalties' | null;
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
    /** Traducciones del nombre por locale; la web cae a `competitionName`. Ver migración 038. */
    competitionNameI18n?: Record<string, string> | null;
    competitionShort: string | null;
    competitionOrganizer: string;
    competitionScope: string;
    competitionCountry: string | null;
    competitionRegion: string | null;
    /** IANA TZ de la competición (migración 042). La web cae a Europe/Madrid. */
    competitionTimezone?: string | null;
  };
  standings: SeasonStandingRow[];
  rounds: SeasonRound[];
  matches: SeasonMatch[];
}

// ─── Player detail ───

export interface PlayerSeasonTotals {
  pj: number;
  goals: number;
  assists: number;
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
  assists: number;
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
    isGoalkeeper: boolean;
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

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
  /** Dirección del pabellón (API de sidgad, migración 104). */
  street?: string | null;
  postalCode?: string | null;
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
  /** País de la competición (ISO alpha-2, 'W' = mundial). Solo en /matches/current y /live. */
  competitionCountry?: string | null;
  /** Logo de la competición (migración 078). Solo en /matches/current y /live. */
  competitionLogoUrl?: string | null;
  /** Importancia de la competición (migración 089). Solo en /matches/current y /live. */
  competitionTier?: number | null;
  competitionFeaturedRank?: number | null;
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

/**
 * Ronda y fase de un partido (`match.round` de `GET /matches/:id`, spec
 * 2026-10-16): la ficha pinta «Semifinal», «Fase de grupos · Grupo A ·
 * Jornada 2»… null si el partido no pertenece a ninguna ronda.
 */
export interface MatchRound {
  name: string | null;
  number: number | null;
  /** regular | playoff | cup | friendly */
  type: string | null;
  /** Fase eliminatoria explícita de la fuente (quarters, semis, final…). */
  stage: string | null;
  groupName: string | null;
  /** Nº de partido de la serie ("2 CUARTOS" → 2). */
  seriesGame: number | null;
  /** league | groups | knockout */
  phaseKind: string | null;
}

export interface MatchDetail {
  match: Match & { referee: string | null; live?: MatchLiveState | null; round?: MatchRound | null };
  events: MatchEvent[];
  stats: MatchStats;
  lineups: MatchLineups;
}

// ─── Competitions ───

export type FederationLevel = 'world' | 'continental' | 'national' | 'regional';

export interface FederationRef {
  code: string;
  slug: string;
  name: string;
  shortName: string;
  level: FederationLevel | string;
  parentCode: string | null;
  country: string | null;
  region: string | null;
}

export interface Federation extends FederationRef {
  website: string | null;
  displayOrder: number;
  competitionCount: number;
}

export interface CompetitionSummary {
  id: string;
  name: string;
  /** Traducciones del nombre por locale; la web cae a `name`. Ver migración 038. */
  nameI18n?: Record<string, string> | null;
  shortName: string | null;
  /** Logo de la competición publicado por la fuente (migración 078). */
  logoUrl?: string | null;
  slug: string;
  gender: string | null;
  category: string | null;
  country: string | null;
  organizer: string;
  scope: 'national' | 'regional' | 'international';
  region: string | null;
  ageCategory: string;
  /** Calidad (#064): el API público solo devuelve competiciones visibles ('ok'). */
  dataQuality?: 'ok' | 'en_revision' | string;
  /** Nivel deportivo dentro de su federación (1 = máxima). Migración 089. */
  tier?: number | null;
  /** Orden en "Destacadas" (curación editorial). null = no destacada. */
  featuredRank?: number | null;
  /** Federación organizadora (JOIN por `organizer`). null si no está dada de alta. */
  federation?: FederationRef | null;
  season: {
    id: string;
    name: string | null;
    startDate?: string | null;
    endDate?: string | null;
    isCurrent: boolean;
    teamCount: number;
    matchCount: number;
    /** Calendario de la temporada (API ≥ 2026-10-29; ausente en payloads antiguos). */
    firstMatchAt?: string | null;
    lastMatchAt?: string | null;
    nextMatchAt?: string | null;
    liveMatches?: number;
    /** Liga: jornada más alta jugada sobre el total. */
    matchday?: { current: number; total: number } | null;
    /** Copa terminada: ganador de la final. */
    champion?: { teamId: string; name: string; shortName: string | null; logoUrl: string | null } | null;
  } | null;
}

export interface CompetitionSeason {
  id: string;
  name: string;
  slug: string;
  isCurrent: boolean;
}

/** Temporada del equipo para el selector de su ficha (con la competición). */
export interface TeamSeason {
  id: string;
  name: string;
  isCurrent: boolean;
  competitionName: string;
  competitionShort: string | null;
}

/**
 * Formato de la competición (competition_sources.external_ids.format,
 * normalizado por la API): 'league' | 'bracket' | 'final_four'.
 * `bracket`/`final_four` = competición eliminatoria, sin clasificación.
 */
export type CompetitionFormat = 'league' | 'bracket' | 'final_four';

/** Competición de la temporada mostrada en la ficha de equipo. */
export interface TeamSeasonInfo {
  competitionId: string;
  competitionSlug: string | null;
  competitionName: string;
  competitionShort: string | null;
  competitionFormat: CompetitionFormat;
  /** Fases de la temporada (ausente en payloads antiguos). */
  phases?: SeasonPhase[];
}

export interface SeasonLeader {
  playerId: string | null;
  playerName: string;
  /** Nombre y apellidos de la ficha (API ≥ C0); ausentes en payloads antiguos. */
  firstName?: string | null;
  lastName?: string | null;
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
  /** Slug de la competición para la URL legible (Plan A). Opcional: API antigua. */
  competitionSlug?: string | null;
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
  /** Ronda del partido (join con `rounds`). Opcional: payload antiguo sin ella. */
  roundId?: string | null;
  roundNumber?: number | null;
  roundName?: string | null;
  roundType?: string | null;
  /** Ganador explícito (eliminatorias resueltas en penaltis/prórroga). */
  winnerTeamId?: string | null;
  winType?: 'regular' | 'overtime' | 'penalties' | null;
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
  /** Faltas directas lanzadas, PJ (actas del equipo) y asistencias. Opcionales: payloads antiguos. */
  directFouls?: number;
  played?: number;
  assists?: number;
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

export interface TeamRecentMatch {
  id: string;
  date: string | null;
  homeTeamId: string;
  homeName: string;
  homeShortName: string | null;
  homeLogoUrl: string | null;
  awayTeamId: string;
  awayName: string;
  awayShortName: string | null;
  awayLogoUrl: string | null;
  homeScore: number;
  awayScore: number;
  competitionId: string;
  competitionName: string;
  competitionShortName: string | null;
  roundNumber: number | null;
}

export interface TeamRecentResponse {
  matches: TeamRecentMatch[];
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
    // Sección club × género × categoría × filial (migraciones 032/044). La API
    // ya las devuelve; aquí son opcionales para no romper payloads antiguos.
    gender?: string | null;
    ageCategory?: string | null;
    squadLevel?: number | null;
    teamType?: string | null;
    // Club canónico (Fase 0.3). NULL hasta que el backfill 0.2 corra en prod.
    club: TeamClub | null;
  };
  standing: TeamStanding | null;
  /** Competición de la temporada mostrada (formato incluido). Opcional: payload antiguo. */
  season?: TeamSeasonInfo | null;
  /**
   * Partidos de TODA la temporada (lite) cuando la competición es
   * eliminatoria: el cuadro completo con el que se derivan las fases. Con sólo
   * los partidos del equipo, la semifinal de un eliminado es indistinguible
   * de una final. Ausente en ligas y en payloads antiguos.
   */
  knockoutMatches?: TeamMatchSummary[];
  /** Temporadas del equipo para el selector (actual primero). */
  seasons?: TeamSeason[];
  /** Temporada mostrada (la de `?season=` o, por defecto, la actual). */
  selectedSeasonId?: string | null;
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
  /** B2: zona reglamentaria de la fila (standings_zones). null o ausente = sin zona declarada. */
  zone?: { kind: import('@/lib/standings-zones-view').ZoneKind; target: string | null } | null;
}

/** Fase eliminatoria canónica (ronda de una fase `knockout`). */
export type KnockoutStage = 'round_of_16' | 'quarters' | 'semis' | 'final' | 'third_place' | 'placement';

/**
 * Fase de una temporada (liga regular, grupos, playoff, final four,
 * colocación…). La estructura de la competición es la SECUENCIA de sus fases;
 * la publica la fuente y la guarda el ETL (migración 072).
 */
export interface SeasonPhase {
  id: string;
  ordinal: number;
  kind: 'league' | 'groups' | 'knockout';
  /** No decide el título (playoff 9.º-10.º, puestos 5.º-8.º…). */
  isPlacement: boolean;
  name: string | null;
  /** La clasificación de la temporada pertenece a esta fase. */
  hasStandings: boolean;
  /** Fases eliminatorias presentes, en orden de juego (vacío en liga/grupos). */
  stages: KnockoutStage[];
  /** Alguna fase eliminatoria es deducida (solo temporadas heredadas). */
  stagesInferred?: boolean;
  /** Estructura publicada por la fuente (false = temporada heredada sin re-scrapear). */
  fromSource?: boolean;
}

export interface SeasonRound {
  id: string;
  number: number;
  name: string | null;
  roundType: 'regular' | 'playoff' | 'cup' | 'friendly';
  /** Fase a la que pertenece (API ≥ fases; ausente en payloads antiguos). */
  phaseId?: string | null;
  stage?: KnockoutStage | null;
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
  /** Marcador de la tanda de penaltis; null/ausente si no hubo. */
  penalties?: MatchScore | null;
  venueName: string | null;
  roundId: string | null;
  roundNumber: number | null;
  roundName: string | null;
  roundType: string;
  /** Grupo de la fase de grupos ("A", "B"...); null en eliminatorias/ligas. */
  groupName?: string | null;
  /** Fase del partido y su fase eliminatoria EXPLÍCITA (de la fuente). */
  phaseId?: string | null;
  stage?: KnockoutStage | null;
  /** Nº de partido dentro de la eliminatoria ("2 CUARTOS" → 2; ida=1, vuelta=2). */
  seriesGame?: number | null;
  /** La fase eliminatoria es deducida (solo temporadas heredadas). */
  stageInferred?: boolean;
  homeTeam: TeamSummary;
  awayTeam: TeamSummary;
}

export interface SeasonOverview {
  season: {
    id: string;
    name: string;
    /** Slug de la temporada (p. ej. "2019-20"). Ver `lib/season-notes`. */
    slug?: string;
    startDate: string | null;
    endDate: string | null;
    competitionId: string;
    /** Slug de la competición (p. ej. "ok-liga-masculina"). Ver `lib/season-notes`. */
    competitionSlug?: string;
    competitionName: string;
    /** Traducciones del nombre por locale; la web cae a `competitionName`. Ver migración 038. */
    competitionNameI18n?: Record<string, string> | null;
    competitionShort: string | null;
    /** Logo de la competición publicado por la fuente (migración 078). */
    competitionLogoUrl?: string | null;
    competitionOrganizer: string;
    competitionScope: string;
    competitionCountry: string | null;
    competitionRegion: string | null;
    /** IANA TZ de la competición (migración 042). La web cae a Europe/Madrid. */
    competitionTimezone?: string | null;
    /**
     * Formato LEGADO derivado de las fases: 'league' | 'bracket' | 'final_four'.
     * Lo nuevo es `phases`; este campo queda para payloads/clientes antiguos.
     */
    competitionFormat?: 'league' | 'bracket' | 'final_four';
    /** Secuencia de fases de la temporada (ausente en payloads antiguos). */
    phases?: SeasonPhase[];
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

export type PlayerMetricKind = 'goals_per_match' | 'assists_per_match' | 'participation' | 'penalty_pct';

export interface PlayerPercentileMetric {
  kind: PlayerMetricKind;
  value: number;
  rank: number;
  percentile: number;
  peers: number;
}

export interface PlayerInsightsFacts {
  goals: number;
  teamGoals: number | null;
  goalSharePct: number | null;
  scorerRank: number | null;
  scoringStreak: number;
  hatTricks: number;
}

export interface PlayerInsights {
  playerId: string;
  season: {
    id: string;
    name: string;
    competitionName: string;
    startDate: string | null;
  } | null;
  metrics: PlayerPercentileMetric[];
  facts?: PlayerInsightsFacts;
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

// ─── Insights de temporada (C2) ───

export type InsightKind =
  | 'only_unbeaten' | 'win_streak' | 'losing_streak' | 'best_attack' | 'best_defense'
  | 'perfect_home' | 'home_win_pct' | 'second_half_goals' | 'team_second_half' | 'late_goals'
  | 'penalty_pct' | 'direct_foul_pct' | 'penalty_drought' | 'scorer_share'
  | 'biggest_win' | 'highest_scoring' | 'first_goal_wins'
  | 'most_blue_cards' | 'most_red_cards';

export interface Insight {
  id: string;
  kind: InsightKind;
  priority: number;
  teamIds: string[];
  playerIds: string[];
  matchId: string | null;
  values: Record<string, number>;
}

export interface SeasonDisciplineRed {
  matchId: string;
  teamId: string;
  playerId: string | null;
  firstName: string | null;
  lastName: string | null;
  minute: number | null;
}

export interface SeasonDiscipline {
  roundNumber: number | null;
  roundName: string | null;
  reds: SeasonDisciplineRed[];
}

export interface SeasonInsights {
  insights: Insight[];
  teams: Record<string, { name: string; shortName: string | null }>;
  players: Record<string, { firstName: string; lastName: string }>;
  matches: Record<string, { homeTeamId: string; awayTeamId: string; date: string | null }>;
  discipline?: SeasonDiscipline;
}

// ─── Club (Plan B1: ficha de club) ───

export interface ClubDetailTeam {
  id: string;
  name: string;
  shortName: string | null;
  gender: string | null;
  ageCategory: string | null;
  squadLevel: number | null;
  sectionSuffix: string;
  competition: { id: string; slug: string | null; name: string; seasonId: string | null; isCurrent: boolean } | null;
  position: number | null;
  /** Sección de la ficha (API ≥ 2026-10-30). */
  section?: 'senior' | 'senior_female' | 'base' | 'veterans';
  lastMatch?: ClubTeamMatch | null;
  nextMatch?: ClubTeamMatch | null;
}

/** Partido visto desde un equipo del club. */
export interface ClubTeamMatch {
  id: string;
  scheduledAt: string | null;
  status: string;
  home: boolean;
  opponent: string;
  opponentId: string;
  goalsFor: number | null;
  goalsAgainst: number | null;
  result: 'W' | 'D' | 'L' | null;
}

export interface ClubDetailMatch {
  id: string;
  scheduledAt: string | null;
  status: string;
  homeScore: number | null;
  awayScore: number | null;
  home: { id: string; name: string };
  away: { id: string; name: string };
  competition: { id: string; slug: string | null; name: string };
}

export interface ClubDetail {
  club: { id: string; slug: string; name: string; city: string | null; country: string | null; crestUrl: string | null };
  teams: ClubDetailTeam[];
  recent: ClubDetailMatch[];
  upcoming: ClubDetailMatch[];
  /** Alguna sección juega la temporada en curso. Si no, la ficha va con noindex. */
  indexable: boolean;
}

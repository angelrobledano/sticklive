import type { MatchStatus } from '@sports/shared-types';

/**
 * Tipos de vista de la app móvil.
 *
 * Formas verificadas por LECTURA DE CÓDIGO del API (Task 2.1 Step 4, sin
 * levantar servidor):
 * - `GET /matches/current` y `GET /matches/live` → `MatchSummary` +
 *   `CurrentMatchesResponse`: mapper `mapLiveRow` en
 *   apps/api/src/routes/live.ts:77-114 (SELECT en 217-238 / 124-160) y
 *   envoltorio `{ count, matches }` en live.ts:240-241 / 162-163.
 * - `GET /matches/:id` (REST) y snapshot/update SSE → `MatchDetail`: espejo
 *   de `MatchDto` en apps/api/src/lib/match-dto.ts:135-166, compartido por
 *   ambas rutas (mapper único `buildMatchDetail`).
 * - `GET /auth/favorites` → `FavoritesResponse`:
 *   apps/api/src/routes/auth.ts:339-356.
 *
 * Task 2.2 añade (misma metodología, sin levantar servidor):
 * - `GET /search` → `SearchResults`: apps/api/src/routes/search.ts:77-91
 *   (buildSearchResults :94-127, c.json :212; con q<2 responde la misma forma
 *   vacía en :202).
 * - `GET /seasons/:id/standings` → `StandingsResponse`: envoltorio en
 *   apps/api/src/routes/standings.ts:40-45; filas SNAKE_CASE = DbStanding
 *   (packages/db/src/queries/standings.ts:4-23) + columnas del JOIN con teams
 *   (queries del :98/:108).
 * - `GET /competitions` → `CompetitionsResponse`: apps/api/src/routes/
 *   competitions.ts:96-121 (ítem con `season` ANIDADA, no `currentSeasonId`).
 */

/**
 * Resumen para listados (home): forma EXACTA de cada elemento de `matches` en
 * `/matches/current` y `/matches/live` (`mapLiveRow`, live.ts:77-114).
 *
 * Diferencias NOTABLES con el detalle (`MatchDto`):
 * - `isHalftime` va A NIVEL RAÍZ (no hay sub-objeto `live`: ni `period` ni
 *   `clockSeconds`; esos sólo existen en el DTO del detalle, match-dto.ts:159).
 * - `status` es el de la BD (para /current, siempre uno de
 *   'scheduled' | 'live' | 'finished', live.ts): solo la fuente pone un partido
 *   en juego; la hora programada no fabrica directos (ni en la API ni en la UI).
 * - `scheduledAt`/`startedAt`: pg devuelve `Date` y `c.json()` lo serializa a
 *   string ISO (de ahí `string | null` y no `Date`).
 * Los partidos de `/seasons/:id/matches` vienen en OTRA forma (snake_case, sin
 * competición, ver RawMatch en apps/web/src/lib/api/client.ts:38-59): esa ruta
 * requerirá su propio tipo cuando se consuma (verificación Step 4 propia).
 */
export interface MatchSummary {
  id: string;
  seasonId: string;
  roundId: string | null;
  competitionId: string | null;
  competitionName: string | null;
  competitionSlug: string | null;
  competitionTimezone: string | null;
  status: MatchStatus;
  /** live.ts:87 — `m.live_is_halftime ?? false`; presente siempre (no null). */
  isHalftime: boolean;
  winType: string | null;
  winnerTeamId: string | null;
  /** Tanda de penaltis ya resuelta: null salvo eliminatorias decididas (live.ts:90-91). */
  penalties: { home: number | null; away: number | null } | null;
  scheduledAt: string | null;
  startedAt: string | null;
  /** live.ts:94-96 — null si el partido no tiene `venue_name`. */
  venue: { name: string; city: string | null } | null;
  score: { home: number | null; away: number | null };
  /** Faltas de equipo acumuladas (live.ts:114): null si el partido no está en vivo o no hay registro. */
  fouls?: { home: number | null; away: number | null } | null;
  homeTeam: { id: string; name: string; shortName: string | null; logoUrl: string | null };
  awayTeam: { id: string; name: string; shortName: string | null; logoUrl: string | null };
}

/** Envoltorio REAL de `/matches/current` y `/matches/live` (live.ts:240-241): NO es un array plano. */
export interface CurrentMatchesResponse {
  count: number;
  matches: MatchSummary[];
}

/** Espejo exacto de MatchDtoStats (apps/api/src/lib/match-dto.ts:116-133). */
export interface MatchStats {
  homeFouls: number;
  awayFouls: number;
  homeGoals: number;
  awayGoals: number;
  homeAssists: number;
  awayAssists: number;
  homeBlueCards: number;
  awayBlueCards: number;
  homeRedCards: number;
  awayRedCards: number;
  homeTimeouts: number;
  awayTimeouts: number;
  homeDirectFouls: { total: number; scored: number };
  awayDirectFouls: { total: number; scored: number };
  homePenalties: { total: number; scored: number };
  awayPenalties: { total: number; scored: number };
}

/** Igual que MatchDto de apps/api/src/lib/match-dto.ts:135-166 (REST y SSE lo comparten). */
export interface MatchDetail {
  match: {
    id: string;
    seasonId: string;
    roundId: string | null;
    competitionId: string | null;
    competitionName: string | null;
    competitionSlug: string | null;
    competitionTimezone: string | null;
    /** Estado de la BD (explícito de la fuente; sin "live" por reloj — match-dto.ts). */
    status: string;
    eventCoverage: string;
    scheduledAt: string | null;
    startedAt: string | null;
    finishedAt: string | null;
    score: { home: number | null; away: number | null };
    winType: string | null;
    winnerTeamId: string | null;
    regulation: { home: number | null; away: number | null } | null;
    penalties: { home: number | null; away: number | null } | null;
    penaltyShootout: { home: { player: string; scored: boolean }[]; away: { player: string; scored: boolean }[] } | null;
    venue: { name: string; city: string | null } | null;
    referee: string | null;
    sourceRef: string | null;
    videoUrl: string | null;
    live: { period: number | null; clockSeconds: number | null; clockAt: string | null; isHalftime: boolean } | null;
    homeTeam: { id: string; name: string; shortName: string | null; logoUrl: string | null };
    awayTeam: { id: string; name: string; shortName: string | null; logoUrl: string | null };
  };
  events: {
    id: string;
    eventType: string;
    minute: number | null;
    period: number | null;
    clock: string | null;
    teamId: string | null;
    isHomeTeam: boolean;
    detail: string | null;
    player: { id: string; firstName: string; lastName: string } | null;
  }[];
  stats: MatchStats;
  lineups: {
    home: {
      jerseyNumber: number | null; playerName: string; isGoalkeeper: boolean;
      isStarter: boolean; isCaptain: boolean; goals: number; assists: number;
      playerId: string | null; photoUrl: string | null;
    }[];
    away: { jerseyNumber: number | null; playerName: string; isGoalkeeper: boolean;
      isStarter: boolean; isCaptain: boolean; goals: number; assists: number;
      playerId: string | null; photoUrl: string | null; }[];
  };
  /**
   * Sólo en el stream SSE: instante de captura del snapshot (el API lo añade
   * al DTO en apps/api/src/routes/match-stream.ts:140-143). REST no lo trae.
   */
  updatedAt?: string;
}

/** Temporada de referencia anidada en cada ítem de /competitions (competitions.ts:110-118). */
export interface CompetitionSeasonSummary {
  id: string;
  name: string;
  /** Fechas de temporada: pg las serializa a string ISO (ídem scheduledAt). */
  startDate: string | null;
  endDate: string | null;
  isCurrent: boolean;
  teamCount: number;
  matchCount: number;
}

/**
 * Ítem de `GET /competitions` (competitions.ts:96-119). Sustituye al
 * placeholder anterior (gender?/currentSeasonId?): la temporada de referencia
 * viene ANIDADA en `season` (no hay `currentSeasonId`) y el ítem incluye
 * slug/categoría/calidad de datos.
 */
export interface CompetitionSummary {
  id: string;
  name: string;
  nameI18n: Record<string, string> | null;
  shortName: string | null;
  logoUrl?: string | null;
  slug: string;
  gender: string | null;
  category: string | null;
  country: string | null;
  organizer: string;
  scope: string;
  region: string | null;
  ageCategory: string;
  dataQuality: string;
  season: CompetitionSeasonSummary | null;
}

/** Envoltorio REAL de `/competitions` (competitions.ts:121): NO es un array plano. */
export interface CompetitionsResponse {
  count: number;
  competitions: CompetitionSummary[];
}

/**
 * Verificado: fila cruda de `/seasons/:id/standings`. El API NO mapea a
 * camelCase: devuelve `DbStanding` tal cual (packages/db/src/queries/
 * standings.ts:4-23; columnas en 001_initial_schema.sql:236-260) más las
 * columnas del JOIN con teams (`team_name`, `team_short_name`,
 * `team_logo_url`; query en standings.ts del paquete db, :98/:108).
 * Los timestamps llegan como string ISO (pg Date → JSON), igual que
 * scheduledAt en MatchSummary.
 */
export interface StandingsRow {
  id: string;
  season_id: string;
  team_id: string;
  /** "Grupo A", "Norte"… null si la liga es de grupo único (schema:240). */
  group_name: string | null;
  position: number | null;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goals_for: number;
  goals_against: number;
  /** Columna generada en BD (schema:250). */
  goal_diff: number;
  points: number;
  /** Últimos 5 resultados ["W","W","D","L","W"] (schema:252). */
  form: string[] | null;
  source_id: string | null;
  scraped_at: string | null;
  created_at: string;
  updated_at: string;
  /** teams.name es NOT NULL (001_initial_schema.sql:90) y el JOIN es inner. */
  team_name: string;
  team_short_name: string | null;
  team_logo_url: string | null;
}

/** Envoltorio REAL de `/seasons/:id/standings` (standings.ts:40-45): NO es un array plano. */
export interface StandingsResponse {
  seasonId: string;
  /** Nombre de grupo si se pidió `?group=`; null en la general (standings.ts:42). */
  group: string | null;
  count: number;
  standings: StandingsRow[];
}

/**
 * Verificado: `SearchResults` de apps/api/src/routes/search.ts:77-91,
 * construido por buildSearchResults (:94-127) y devuelto por c.json (:212).
 * Con `q` de menos de 2 caracteres el API responde la MISMA forma vacía
 * (:202), pero la app móvil ni siquiera dispara la petición (gating en
 * useSearch). OJO: los jugadores van separados en firstName/lastName (no hay
 * `name`) y el envoltorio añade `query` y `total`.
 */
export interface SearchResults {
  query: string;
  total: number;
  teams: { id: string; name: string; shortName: string | null; logoUrl: string | null; country: string | null }[];
  players: { id: string; firstName: string; lastName: string; photoUrl: string | null; teamName: string | null }[];
  competitions: {
    id: string;
    name: string;
    nameI18n: Record<string, string> | null;
    shortName: string | null;
    country: string | null;
    scope: string | null;
    seasonName: string | null;
  }[];
}

/** Verificado: apps/api/src/routes/auth.ts:346-350 (refs agrupadas por kind). */
export interface FavoritesResponse {
  teams: string[];
  leagues: string[];
  players: string[];
}

export interface TeamSeason {
  id: string;
  name: string;
  isCurrent: boolean;
  competitionName: string;
  competitionShort: string | null;
}

export interface TeamSeasonInfo {
  competitionId: string;
  competitionSlug?: string | null;
  competitionName: string;
  competitionShort: string | null;
  competitionFormat?: string | null;
  phases?: {
    id: string;
    ordinal: number;
    kind: string;
    isPlacement: boolean;
    name: string | null;
    hasStandings: boolean;
    stages: string[];
  }[];
}

export interface TeamStaffMember {
  name: string;
  role: string;
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

export interface ClubTeamSummary {
  id: string;
  name: string;
  shortName: string | null;
  logoUrl: string | null;
  gender?: string | null;
  ageCategory?: string | null;
  squadLevel?: number | null;
  teamType?: string | null;
  sectionSuffix?: string;
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

export interface TeamMatchSummary {
  id: string;
  status: string;
  competitionTimezone?: string | null;
  scheduledAt: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  score: { home: number | null; away: number | null };
  venue?: { name: string; city: string | null } | null;
  roundId?: string | null;
  roundNumber?: number | null;
  roundName?: string | null;
  roundType?: string | null;
  phaseId?: string | null;
  stage?: string | null;
  seriesGame?: number | null;
  winnerTeamId?: string | null;
  winType?: 'regular' | 'overtime' | 'penalties' | null;
  homeTeam: { id: string; name: string; shortName: string | null; logoUrl: string | null };
  awayTeam: { id: string; name: string; shortName: string | null; logoUrl: string | null };
}

/**
 * Task 2.5 — `GET /teams/:id` → `TeamDetail`, verificado contra
 * apps/api/src/routes/team-detail.ts (c.json en :458).
 */
export interface TeamDetail {
  team: {
    id: string;
    name: string;
    shortName: string | null;
    city?: string | null;
    country?: string | null;
    logoUrl?: string | null;
    websiteUrl?: string | null;
    gender?: string | null;
    ageCategory?: string | null;
    squadLevel?: number | null;
    teamType?: string | null;
    /** #196: sufijo de sección (género/categoría/filial), team-detail.ts:386. */
    sectionSuffix: string | null;
    club?: {
      id: string;
      canonicalName: string | null;
      slug: string | null;
      crestUrl: string | null;
      city: string | null;
      country: string | null;
    } | null;
  };
  clubTeams?: ClubTeamSummary[];
  /** Standing de la temporada activa; null sin clasificación (playoffs, etc.). */
  standing: {
    seasonId?: string;
    competitionId?: string;
    competitionName: string;
    competitionShort?: string | null;
    position: number | null;
    played: number;
    won: number;
    drawn: number;
    lost: number;
    goalsFor?: number;
    goalsAgainst?: number;
    goalDiff: number;
    points: number;
    form?: string[];
    penalizationPoints?: number;
  } | null;
  season?: TeamSeasonInfo | null;
  seasons?: TeamSeason[];
  selectedSeasonId?: string | null;
  knockoutMatches?: TeamMatchSummary[];
  matches: TeamMatchSummary[];
  squad: {
    playerId: string;
    firstName: string;
    lastName: string;
    photoUrl?: string | null;
    isGoalkeeper: boolean;
    jerseyNumber: number | null;
    goals: number;
    blueCards?: number;
    redCards?: number;
    penalties?: number;
  }[];
  staff?: TeamStaffMember[];
  stats?: TeamSeasonStats | null;
}

/**
 * Task 2.5 — `GET /players/:id` → `PlayerDetail`, verificado contra
 * apps/api/src/routes/player-detail.ts (c.json en :276-310) y el shape de
 * `career` = `PlayerCareer` de apps/api/src/lib/player-career.ts:76-79
 * (CareerSeason :62-73, CareerStats :40-47). Ídem: sólo lo pintado — el JSON
 * trae además sourceRef/birthDate/statsByCompetition.
 */
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
    birthDate?: string | null;
    nationality: string | null;
    isGoalkeeper: boolean;
    photoUrl: string | null;
  };
  /** Última temporada con registro del jugador (player-detail.ts:287-294); null sin plantilla. */
  currentTeam: {
    id: string;
    name: string;
    shortName: string | null;
    jerseyNumber: number | null;
  } | null;
  /** Suma de la temporada activa (player-detail.ts:263-274). */
  seasonTotals: {
    pj: number;
    goals: number;
    assists: number;
    blueCards: number;
    redCards: number;
    penaltiesTotal: number;
    penaltiesScored: number;
  };
  statsByCompetition?: PlayerCompStats[];
  career: {
    seasons: {
      seasonId: string;
      seasonName: string;
      isCurrent: boolean;
      competitionName: string;
      totals: { pj: number; goals: number };
      teams: { competitionId: string; teamId: string; teamName: string; pj: number; goals: number }[];
    }[];
    totals: { pj: number; goals: number };
  };
}

/**
 * Verificado: `GET /payments/status` (apps/api/src/routes/payments-status.ts,
 * c.json en :37-41). Estado premium de la SESIÓN (Bearer): la compra es SOLO en
 * la web y la app se limita a LEER este entitlement para decidir si muestra
 * publicidad. `premiumUntil` llega como string ISO o null (pg Date → JSON,
 * ídem scheduledAt en MatchSummary); el guard único del API es
 * isUserPremium (lifetime OR premium_until > NOW()) y NO expone flags internos.
 */
export interface PremiumStatus {
  premium: boolean;
  premiumUntil: string | null;
  premiumLifetime: boolean;
}

/**
 * Plan D — verificado: `GET /ads/config` (apps/api/src/routes/ads-config.ts,
 * `buildAdsConfig`). Config remota de formatos de anuncios, PÚBLICA (se pide
 * sin sesión, vía `fetchAdsConfig`): qué formatos existen y sus caps. Todo
 * nace `enabled: false` en el API (fail-safe — la activación es explícita por
 * env + redeploy, la app la lee en runtime sin rebuild). Debe mantenerse
 * IDÉNTICO al shape del API: un campo nuevo allí exige añadirlo aquí.
 */
export interface AdsConfig {
  appOpen: { enabled: boolean; minIntervalHours: number };
  interstitial: { enabled: boolean; minIntervalMinutes: number; maxPerHour: number };
  rewarded: { enabled: boolean; adfreeMinutes: number };
  nativeFeed: { enabled: boolean; everyNItems: number };
}

export type KnockoutStage = 'round_of_16' | 'quarters' | 'semis' | 'final' | 'third_place' | 'placement';

export interface SeasonPhase {
  id: string;
  ordinal: number;
  kind: 'league' | 'group' | 'knockout';
  isPlacement: boolean;
  name: string | null;
  hasStandings: boolean;
  stages: KnockoutStage[];
  stagesInferred: boolean;
  fromSource: boolean;
}

export interface SeasonLeader {
  playerId: string | null;
  playerName: string;
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

export interface SeasonOverviewMatch {
  id: string;
  status: MatchStatus;
  competitionTimezone: string | null;
  scheduledAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  score: { home: number | null; away: number | null };
  winnerTeamId: string | null;
  winType: string | null;
  penalties: { home: number; away: number } | null;
  venueName: string | null;
  roundId: string | null;
  groupName: string | null;
  phaseId: string | null;
  stage: string | null;
  seriesGame: number | null;
  roundNumber: number | null;
  roundName: string | null;
  roundType: string | null;
  homeTeam: {
    id: string;
    name: string;
    shortName: string | null;
    logoUrl: string | null;
  };
  awayTeam: {
    id: string;
    name: string;
    shortName: string | null;
    logoUrl: string | null;
  };
}

export interface SeasonOverviewStandingRow {
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
  form?: string[];
  penalizationPoints?: number;
  zone?: { kind: import('@/src/lib/standings-zones-view').ZoneKind; target: string | null } | null;
}

export interface SeasonOverview {
  season: {
    id: string;
    name: string;
    slug: string;
    startDate: string | null;
    endDate: string | null;
    competitionId: string;
    competitionName: string;
    competitionSlug: string;
    competitionShortName: string | null;
    competitionLogoUrl: string | null;
    competitionOrganizer: string;
    competitionScope: string;
    competitionCountry: string | null;
    competitionRegion: string | null;
    competitionTimezone: string | null;
    competitionFormat: string | null;
    phases?: SeasonPhase[];
  };
  standings: SeasonOverviewStandingRow[];
  rounds: {
    id: string;
    number: number;
    name: string | null;
    roundType: string;
    phaseId?: string | null;
    stage?: string | null;
  }[];
  matches: SeasonOverviewMatch[];
}

export interface CompetitionSeasonsResponse {
  seasons: {
    id: string;
    name: string;
    slug: string;
    isCurrent: boolean;
  }[];
}

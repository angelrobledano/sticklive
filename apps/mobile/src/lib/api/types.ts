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
 * - `status` es el crudo de la BD (para /current, siempre uno de
 *   'scheduled' | 'live' | 'finished', live.ts:235): NO pasa por
 *   `effectiveMatchStatus`; el badge "EN VIVO por reloj" lo calcula la UI con
 *   `STALE_LIVE_HOURS` (#150, como apps/api/src/lib/effective-status.ts y la web).
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
    /** Aquí SÍ es el estado efectivo (live adelantado, acotado por STALE_LIVE_HOURS; match-dto.ts:277). */
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

/**
 * Task 2.5 — `GET /teams/:id` → `TeamDetail`, verificado contra
 * apps/api/src/routes/team-detail.ts (c.json en :458). Sólo se declaran los
 * campos que pinta la app (el JSON real trae además club/clubTeams/staff/stats;
 * los campos no declarados se ignoran en runtime).
 *
 * OJO: `matches` NO es `MatchSummary` — es un shape PROPIO (:408-429) sin
 * competitionName/isHalftime/live; `status` es el crudo de la BD. Por eso la
 * ficha de equipo pinta filas locales en vez de reutilizar MatchCard.
 * Timestamps pg → string ISO (ídem scheduledAt en MatchSummary).
 */
export interface TeamDetail {
  team: {
    id: string;
    name: string;
    shortName: string | null;
    /** #196: sufijo de sección (género/categoría/filial), team-detail.ts:386. */
    sectionSuffix: string | null;
  };
  /** Standing de la temporada ACTIVA; null sin clasificación (playoffs, etc.). */
  standing: {
    competitionName: string;
    position: number | null;
    played: number;
    won: number;
    drawn: number;
    lost: number;
    goalDiff: number;
    points: number;
  } | null;
  matches: {
    id: string;
    status: string;
    scheduledAt: string | null;
    score: { home: number | null; away: number | null };
    homeTeam: { id: string; name: string; shortName: string | null; logoUrl: string | null };
    awayTeam: { id: string; name: string; shortName: string | null; logoUrl: string | null };
  }[];
  squad: {
    playerId: string;
    firstName: string;
    lastName: string;
    isGoalkeeper: boolean;
    jerseyNumber: number | null;
    goals: number;
  }[];
}

/**
 * Task 2.5 — `GET /players/:id` → `PlayerDetail`, verificado contra
 * apps/api/src/routes/player-detail.ts (c.json en :276-310) y el shape de
 * `career` = `PlayerCareer` de apps/api/src/lib/player-career.ts:76-79
 * (CareerSeason :62-73, CareerStats :40-47). Ídem: sólo lo pintado — el JSON
 * trae además sourceRef/birthDate/statsByCompetition.
 */
export interface PlayerDetail {
  player: {
    id: string;
    firstName: string;
    lastName: string;
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
  seasonTotals: { pj: number; goals: number; assists: number };
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

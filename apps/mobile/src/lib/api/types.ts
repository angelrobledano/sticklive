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
}

export interface CompetitionSummary {
  id: string;
  name: string;
  gender?: string;
  currentSeasonId?: string | null;
}

export interface StandingsRow {
  teamId: string;
  teamName: string;
  shortName: string | null;
  logoUrl: string | null;
  position?: number;
  played?: number; won?: number; drawn?: number; lost?: number;
  goalsFor?: number; goalsAgainst?: number; points?: number;
  [key: string]: unknown;
}

export interface SearchResults {
  teams: { id: string; name: string; logoUrl: string | null }[];
  players: { id: string; name: string; teamName?: string | null }[];
  competitions: { id: string; name: string }[];
}

/** Verificado: apps/api/src/routes/auth.ts:346-350 (refs agrupadas por kind). */
export interface FavoritesResponse {
  teams: string[];
  leagues: string[];
  players: string[];
}

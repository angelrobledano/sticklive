import pg from 'pg';
import { db } from '../client.js';
import type { MatchStatus } from '@sports/shared-types';

export interface DbMatch {
  id: string;
  season_id: string;
  round_id: string | null;
  home_team_id: string;
  away_team_id: string;
  home_score: number | null;
  away_score: number | null;
  status: MatchStatus;
  scheduled_at: Date | null;
  started_at: Date | null;
  finished_at: Date | null;
  venue_name: string | null;
  venue_city: string | null;
  is_neutral: boolean;
  attendance: number | null;
  referee: string | null;
  notes: string | null;
  source_id: string | null;
  source_ref: string | null;
  source_url: string | null;
  scraped_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface UpsertMatchInput {
  seasonId: string;
  roundId?: string;
  homeTeamId: string;
  awayTeamId: string;
  homeScore?: number;
  awayScore?: number;
  status: MatchStatus;
  scheduledAt?: Date;
  startedAt?: Date;
  finishedAt?: Date;
  venueName?: string;
  venueCity?: string;
  isNeutral?: boolean;
  attendance?: number;
  referee?: string;
  notes?: string;
  sourceId?: string;
  sourceRef: string;  // Obligatorio — es la clave de deduplicación
  sourceUrl?: string;
  scrapedAt?: Date;
}

/**
 * Upsert de partido.
 * Clave de conflicto: source_ref — el ID que asigna la fuente al partido.
 *
 * TRADEOFF: usar source_ref como clave en vez de (season, home, away, date)
 * porque los partidos pueden reprogramarse y cambiar de fecha. source_ref es
 * el identificador estable de la fuente.
 *
 * Si la fuente no proporciona source_ref estable, la alternativa es
 * (season_id, home_team_id, away_team_id, DATE(scheduled_at)).
 * Documentado en docs/architecture.md.
 */
export async function upsertMatch(
  input: UpsertMatchInput,
  client: pg.PoolClient | typeof db = db
): Promise<DbMatch> {
  const result = await client.query<DbMatch>(
    `INSERT INTO matches
       (season_id, round_id, home_team_id, away_team_id,
        home_score, away_score, status,
        scheduled_at, started_at, finished_at,
        venue_name, venue_city, is_neutral, attendance, referee, notes,
        source_id, source_ref, source_url, scraped_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
     ON CONFLICT (source_ref) WHERE (source_ref IS NOT NULL) DO UPDATE SET
       home_score   = COALESCE(EXCLUDED.home_score,  matches.home_score),
       away_score   = COALESCE(EXCLUDED.away_score,  matches.away_score),
       status       = EXCLUDED.status,
       scheduled_at = COALESCE(EXCLUDED.scheduled_at, matches.scheduled_at),
       started_at   = COALESCE(EXCLUDED.started_at,   matches.started_at),
       finished_at  = COALESCE(EXCLUDED.finished_at,  matches.finished_at),
       venue_name   = COALESCE(EXCLUDED.venue_name,   matches.venue_name),
       round_id     = COALESCE(EXCLUDED.round_id,     matches.round_id),
       attendance   = COALESCE(EXCLUDED.attendance,   matches.attendance),
       referee      = COALESCE(EXCLUDED.referee,      matches.referee),
       scraped_at   = EXCLUDED.scraped_at,
       updated_at   = NOW()
     RETURNING *`,
    [
      input.seasonId,
      input.roundId ?? null,
      input.homeTeamId,
      input.awayTeamId,
      input.homeScore ?? null,
      input.awayScore ?? null,
      input.status,
      input.scheduledAt ?? null,
      input.startedAt ?? null,
      input.finishedAt ?? null,
      input.venueName ?? null,
      input.venueCity ?? null,
      input.isNeutral ?? false,
      input.attendance ?? null,
      input.referee ?? null,
      input.notes ?? null,
      input.sourceId ?? null,
      input.sourceRef,
      input.sourceUrl ?? null,
      input.scrapedAt ?? null,
    ]
  );
  return result.rows[0]!;
}

export interface GetMatchesFilter {
  seasonId: string;
  gameweek?: number;
  status?: string;
  teamId?: string;
}

/** DbMatch enriquecido con nombres de equipos (via JOIN) */
export interface DbMatchWithTeams extends DbMatch {
  home_team_name: string | null;
  home_team_short_name: string | null;
  home_team_logo_url: string | null;
  away_team_name: string | null;
  away_team_short_name: string | null;
  away_team_logo_url: string | null;
}

/**
 * Consulta de partidos con filtros dinámicos + nombres de equipos.
 * Los filtros son todos opcionales salvo seasonId.
 * teamId busca en home_team_id OR away_team_id.
 */
export async function getMatchesBySeason(
  filter: GetMatchesFilter
): Promise<DbMatchWithTeams[]> {
  const conditions: string[] = ['m.season_id = $1'];
  const params: unknown[]    = [filter.seasonId];
  let idx = 2;

  if (filter.gameweek !== undefined) {
    conditions.push(`r.number = $${idx}`);
    params.push(filter.gameweek);
    idx++;
  }
  if (filter.status !== undefined) {
    conditions.push(`m.status = $${idx}`);
    params.push(filter.status);
    idx++;
  }
  if (filter.teamId !== undefined) {
    conditions.push(`(m.home_team_id = $${idx} OR m.away_team_id = $${idx})`);
    params.push(filter.teamId);
    idx++;
  }

  const where      = conditions.join(' AND ');
  const joinRounds = filter.gameweek !== undefined
    ? 'LEFT JOIN rounds r ON r.id = m.round_id'
    : '';

  const result = await db.query<DbMatchWithTeams>(
    `SELECT
       m.*,
       ht.name         AS home_team_name,
       ht.short_name   AS home_team_short_name,
       ht.logo_url     AS home_team_logo_url,
       at.name         AS away_team_name,
       at.short_name   AS away_team_short_name,
       at.logo_url     AS away_team_logo_url
     FROM matches m
     LEFT JOIN teams ht ON ht.id = m.home_team_id
     LEFT JOIN teams at ON at.id = m.away_team_id
     ${joinRounds}
     WHERE ${where}
     ORDER BY m.scheduled_at ASC NULLS LAST`,
    params
  );

  return result.rows;
}


// ============================================================
// MATCH EVENTS
// ============================================================

export interface UpsertMatchEventInput {
  // 'foul' y 'direct_foul' son válidos en BD desde la migración 008; el tipo
  // estaba desactualizado y rompía el typecheck del scraper de actas (Q2).
  eventType: 'goal' | 'penalty' | 'blue_card' | 'red_card' | 'timeout' | 'period_end' | 'foul' | 'direct_foul';
  minute: number | null;
  period: number | null;
  /** Tiempo RESTANTE del crono al ocurrir el evento, "MM:SS" (cuenta atrás) */
  clock?: string | null;
  /** UUID del equipo en DB (puede ser null si no se pudo resolver) */
  teamId: string | null;
  /** UUID del jugador en DB (puede ser null) */
  playerId: string | null;
  detail: string | null;
  sourceRef: string;   // e.g. "fep_event_34267_0"
  sourceId?: string;
  scrapedAt?: Date;
}

/**
 * Reemplaza todos los eventos de un partido en una sola transaccion.
 * Estrategia DELETE + INSERT para garantizar idempotencia: cada vez que
 * corre el scraper de ficha devuelve el listado completo y este metodo
 * lo vuelca limpio.
 */
export async function replaceMatchEvents(
  matchId: string,
  events: UpsertMatchEventInput[],
  client: pg.PoolClient | typeof db = db
): Promise<void> {
  // Borrar eventos anteriores del partido
  await client.query('DELETE FROM match_events WHERE match_id = $1', [matchId]);

  if (events.length === 0) return;

  // Insertar todos los eventos en batch
  const values: unknown[] = [];
  const placeholders: string[] = [];
  let idx = 1;

  for (const ev of events) {
    placeholders.push(
      `($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`
    );
    values.push(
      matchId,
      ev.teamId,
      ev.playerId,
      ev.eventType,
      ev.minute,
      ev.period,
      ev.clock ?? null,
      ev.detail,
      ev.sourceId ?? null,
      ev.sourceRef,
      ev.scrapedAt ?? null
    );
  }

  await client.query(
    `INSERT INTO match_events
       (match_id, team_id, player_id, event_type, minute, period, clock, detail, source_id, source_ref, scraped_at)
     VALUES ${placeholders.join(', ')}`,
    values
  );
}

// ── Alineaciones ─────────────────────────────────────────────────────────────

export interface UpsertMatchLineupInput {
  isHome: boolean;
  jerseyNumber?: number;
  playerName: string;
  isGoalkeeper?: boolean;
  isStarter?: boolean;
  isCaptain?: boolean;
  goals?: number;
  assists?: number;
  playerId?: string;
  /** Cuerpo técnico: 'E1' | 'E2' | 'A' | 'D'. NULL/undefined = jugador. */
  role?: string;
  sourceRef?: string;
  scrapedAt?: Date;
}

/**
 * Reemplaza la alineación completa de un partido (idempotente por re-scrape).
 */
export async function replaceMatchLineups(
  matchId: string,
  lineups: UpsertMatchLineupInput[],
  client: pg.PoolClient | typeof db = db
): Promise<void> {
  await client.query('DELETE FROM match_lineups WHERE match_id = $1', [matchId]);
  if (lineups.length === 0) return;

  const values: unknown[] = [];
  const placeholders: string[] = [];
  let idx = 1;

  for (const l of lineups) {
    placeholders.push(
      `($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`
    );
    values.push(
      matchId,
      l.isHome,
      l.jerseyNumber ?? null,
      l.playerName,
      l.isGoalkeeper ?? false,
      l.isStarter ?? false,
      l.isCaptain ?? false,
      l.goals ?? 0,
      l.assists ?? 0,
      l.playerId ?? null,
      l.role ?? null,
      l.sourceRef ?? null,
      l.scrapedAt ?? null
    );
  }

  await client.query(
    `INSERT INTO match_lineups
       (match_id, is_home, jersey_number, player_name, is_goalkeeper, is_starter, is_captain, goals, assists, player_id, role, source_ref, scraped_at)
     VALUES ${placeholders.join(', ')}
     ON CONFLICT (match_id, is_home, player_name) DO NOTHING`,
    values
  );
}

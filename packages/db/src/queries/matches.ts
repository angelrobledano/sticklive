import pg from 'pg';
import { db } from '../client.js';
import { createLogger } from '@sports/logger';
import type { MatchStatus } from '@sports/shared-types';

const log = createLogger({ module: 'db.matches' });

export interface DbMatch {
  id: string;
  season_id: string;
  round_id: string | null;
  /** Fase de la temporada (072). */
  phase_id?: string | null;
  /** Nº de partido dentro de la eliminatoria (072). */
  series_game?: number | null;
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
  video_url: string | null;
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
  /**
   * Estado OBSERVADO en la fuente. `undefined` = la fuente no dice nada del
   * estado (p. ej. una fila de calendario sin resultado): en un alta el partido
   * nace `scheduled` y en una actualización se CONSERVA el estado actual. Así una
   * fuente que no sabe si el partido está en juego no puede pisar a la que sí lo
   * sabe (feed en vivo). La transición la resuelve `resolveStatusTransition`
   * (@sports/shared-types) en el loader.
   */
  status?: MatchStatus;
  scheduledAt?: Date;
  startedAt?: Date;
  finishedAt?: Date;
  venueName?: string;
  venueCity?: string;
  videoUrl?: string;
  isNeutral?: boolean;
  attendance?: number;
  referee?: string;
  notes?: string;
  /** Grupo de la fase de grupos ("A", "B"...). NULL = sin grupos (eliminatorias). */
  groupName?: string;
  /** Fase de la temporada (migración 072). Se conserva si no viene. */
  phaseId?: string;
  /** Nº de partido dentro de la eliminatoria ("2 CUARTOS" → 2). */
  seriesGame?: number;
  sourceId?: string;
  sourceRef: string;  // Obligatorio — es la clave de deduplicación
  sourceUrl?: string;
  scrapedAt?: Date;
  /** Lote de importación (A4). Solo se fija en el INSERT de partidos NUEVOS;
   *  NULL = partido nativo. El ON CONFLICT no lo toca, para no arrastrar nativos
   *  de prod al lote de promoción. */
  importBatchId?: string;
  /** Enrich (A5). Si true, el ON CONFLICT ADEMÁS reasigna season_id a la
   *  temporada real y etiqueta la fila con el import_batch, para sacar el partido
   *  del 'Histórico' colapsado. Por defecto false → comportamiento add-only (#114). */
  enrich?: boolean;
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
  // Enrich (A5): en el ON CONFLICT, además de la fecha, mueve el partido a su
  // temporada real y lo etiqueta con el lote. En add-only (#114) estas dos
  // columnas NO se tocan al hacer UPDATE, para no arrastrar nativos al lote.
  const enrichSet = input.enrich
    ? `season_id       = EXCLUDED.season_id,
       import_batch_id = EXCLUDED.import_batch_id,\n       `
    : '';
  const result = await client.query<DbMatch>(
    `INSERT INTO matches
       (season_id, round_id, home_team_id, away_team_id,
        home_score, away_score, status,
        scheduled_at, started_at, finished_at,
        venue_name, venue_city, is_neutral, attendance, referee, notes,
        group_name,
        source_id, source_ref, source_url, scraped_at, video_url, import_batch_id,
        phase_id, series_game)
     VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::text, 'scheduled'),$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
     ON CONFLICT (source_ref) WHERE (source_ref IS NOT NULL) DO UPDATE SET
       ${enrichSet}home_score   = COALESCE(EXCLUDED.home_score,  matches.home_score),
       away_score   = COALESCE(EXCLUDED.away_score,  matches.away_score),
       -- Coherencia del ganador (#326, CHECK matches_winner_score_coherence):
       -- el marcador lo trae el feed y win_type/winner los deriva el ETL
       -- después. Si el marcador RESULTANTE queda en empate y el tipo de
       -- victoria no es 'penalties', el estado derivado anterior ya no es
       -- válido (y el CHECK rechazaría el UPDATE): se invalida aquí para que
       -- derive-results lo recalcule con el acta corregida. 'penalties' se
       -- conserva: ahí el empate ES el resultado y el ganador lo puso el acta.
       win_type = CASE
         WHEN COALESCE(EXCLUDED.home_score, matches.home_score) IS NOT NULL
          AND COALESCE(EXCLUDED.home_score, matches.home_score)
            = COALESCE(EXCLUDED.away_score, matches.away_score)
          AND matches.win_type IS DISTINCT FROM 'penalties'
         THEN NULL ELSE matches.win_type END,
       winner_team_id = CASE
         WHEN COALESCE(EXCLUDED.home_score, matches.home_score) IS NOT NULL
          AND COALESCE(EXCLUDED.home_score, matches.home_score)
            = COALESCE(EXCLUDED.away_score, matches.away_score)
          AND matches.win_type IS DISTINCT FROM 'penalties'
         THEN NULL ELSE matches.winner_team_id END,
       -- Sin observación de estado ($7 NULL) se conserva el actual: el
       -- calendario no puede deshacer un directo que solo conoce el feed.
       status       = COALESCE($7::text, matches.status),
       scheduled_at = COALESCE(EXCLUDED.scheduled_at, matches.scheduled_at),
       -- started_at/finished_at se fijan UNA vez (#189): no se pisan en los
       -- re-scrapes (el loader los sella en la transición a live/finished).
       started_at   = COALESCE(matches.started_at,   EXCLUDED.started_at),
       finished_at  = COALESCE(matches.finished_at,  EXCLUDED.finished_at),
       venue_name   = COALESCE(EXCLUDED.venue_name,   matches.venue_name),
       video_url    = COALESCE(EXCLUDED.video_url,    matches.video_url),
       round_id     = COALESCE(EXCLUDED.round_id,     matches.round_id),
       group_name   = COALESCE(EXCLUDED.group_name,   matches.group_name),
       phase_id     = COALESCE(EXCLUDED.phase_id,     matches.phase_id),
       series_game  = COALESCE(EXCLUDED.series_game,  matches.series_game),
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
      input.status ?? null,
      input.scheduledAt ?? null,
      input.startedAt ?? null,
      input.finishedAt ?? null,
      input.venueName ?? null,
      input.venueCity ?? null,
      input.isNeutral ?? false,
      input.attendance ?? null,
      input.referee ?? null,
      input.notes ?? null,
      input.groupName ?? null,
      input.sourceId ?? null,
      input.sourceRef,
      input.sourceUrl ?? null,
      input.scrapedAt ?? null,
      input.videoUrl ?? null,
      input.importBatchId ?? null,
      input.phaseId ?? null,
      input.seriesGame ?? null,
    ]
  );
  return result.rows[0]!;
}

export interface GetMatchesFilter {
  seasonId: string;
  gameweek?: number;
  status?: string;
  teamId?: string;
  /** Paginación (#323). undefined = sin límite (compatibilidad con la web). */
  limit?: number;
  offset?: number;
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

  // Paginación (#323): la ruta más pesada de la API devolvía SIEMPRE la
  // temporada completa (1,7 MB en históricas). limit/offset son opcionales:
  // sin ellos, comportamiento previo (la web pide la lista completa).
  const pagination = [
    filter.limit !== undefined ? `LIMIT ${Math.floor(filter.limit)}` : '',
    filter.offset !== undefined ? `OFFSET ${Math.floor(filter.offset)}` : '',
  ].filter(Boolean).join(' ');

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
     ORDER BY m.scheduled_at ASC NULLS LAST
     ${pagination}`,
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
 * Deduplica eventos por `source_ref` de cara al `ON CONFLICT` (#375 P3-2).
 *
 * El parser ya evita colisiones añadiendo contenido a la clave, pero otras
 * fuentes podrían repetirla. Antes ganaba siempre la última aparición, lo que
 * podía descartar el evento que traía jugador/equipo/detalle. Preferimos el más
 * completo y, en empate de información, mantenemos el último (comportamiento
 * previo, para no alterar lo que ya funcionaba).
 */
export function dedupeMatchEventsBySourceRef(
  events: UpsertMatchEventInput[]
): UpsertMatchEventInput[] {
  const bySourceRef = new Map<string, UpsertMatchEventInput>();
  for (const ev of events) {
    const prev = bySourceRef.get(ev.sourceRef);
    if (!prev || eventRichness(ev) >= eventRichness(prev)) {
      bySourceRef.set(ev.sourceRef, ev);
    }
  }
  return [...bySourceRef.values()];
}

/** Cuánta información observable trae un evento (para desempatar colisiones). */
function eventRichness(ev: UpsertMatchEventInput): number {
  return (
    (ev.playerId != null ? 1 : 0) +
    (ev.teamId != null ? 1 : 0) +
    (ev.detail != null ? 1 : 0) +
    (ev.minute != null ? 1 : 0)
  );
}

/**
 * Sincroniza los eventos de un partido con el listado completo que devuelve la
 * ficha, MANTENIENDO ESTABLE el `id` de cada evento entre ciclos de scraping.
 *
 * Antes esto era un DELETE + INSERT. Funcionaba, pero como `id` es
 * `gen_random_uuid()`, cada gol cambiaba de UUID cada ~45 s. Efectos:
 *   · el timeline del cliente se re-renderizaba entero en directo (cambia el
 *     `key` de React de cada fila);
 *   · el push-dispatcher no podía diffear por id y tenía que hacerlo por
 *     CONTEO, que pierde la notificación si la fuente corrige un evento
 *     (quita uno y añade otro) dentro del mismo ciclo;
 *   · era imposible referenciar un evento de forma estable (deep-link,
 *     correcciones manuales).
 *
 * Ahora se hace upsert contra `uq_match_events_match_source_ref`
 * (migración 034) y se borran sólo los que ya no vienen en la ficha.
 *
 * Sigue siendo idempotente: la ficha manda siempre el listado completo.
 * Debe llamarse dentro de una transacción para que un lector concurrente
 * (el hub SSE) no vea un estado intermedio.
 *
 * PARTICIONADO (migración 047): match_events está particionada por `match_date`
 * (RANGE por temporada). match_date se deriva AQUÍ desde el partido. Va en el
 * INSERT, en la clave del ON CONFLICT y en el DELETE, para que Postgres pode a la
 * partición del partido en vez de barrer todas.
 *
 * REPROGRAMACIONES (#320): la 047 asumía match_date inmutable (funcionalmente
 * dependiente de match_id) y NO lo es: un aplazamiento cambia scheduled_at. Con
 * la clave única (match_id, source_ref, match_date), los eventos quedados en la
 * fecha/partición antigua ya no casan con el ON CONFLICT ni los alcanza el
 * DELETE acotado, y el timeline duplicaría goles sin autocorrección. Antes de
 * insertar se borran los eventos del partido cuya match_date difiera de la
 * actual (cruza particiones: sin poda, pero cada partición resuelve por el
 * índice (match_id, match_date), así que es una sonda barata). El caso normal
 * (misma fecha) no se toca: los ids siguen estables ciclo a ciclo.
 */
export async function replaceMatchEvents(
  matchId: string,
  events: UpsertMatchEventInput[],
  client: pg.PoolClient | typeof db = db
): Promise<void> {
  // Fecha de partición del partido: la del calendario, con centinela 1900 para
  // partidos sin fecha (caen en match_events_undated). Igual que el COALESCE de
  // la migración 047. Se aprovecha para leer el cruce real (home/away): ver la
  // guarda de equipos intrusos más abajo.
  const { rows: mrows } = await client.query<{
    match_date: string;
    home_team_id: string | null;
    away_team_id: string | null;
  }>(
    `SELECT COALESCE(scheduled_at::date, finished_at::date, DATE '1900-01-01')::text AS match_date,
            home_team_id, away_team_id
       FROM matches WHERE id = $1`,
    [matchId]
  );
  const match = mrows[0];
  const matchDate = match?.match_date;
  if (!matchDate) throw new Error(`replaceMatchEvents: el partido ${matchId} no existe`);

  // Guarda (#149): una ficha que llega VACÍA (parseo roto) no debe borrar la
  // cronología ya cargada — ni ahora tampoco la de una fecha anterior (una
  // reprogramación con parser roto no debe vaciar el timeline viejo).
  // "Los malos datos son peores que no tener datos": se conserva lo que hay y
  // el caller registra el caso (scrape_log / aviso).
  if (events.length === 0) return;

  // REPROGRAMACIÓN (#320): fuera los eventos del partido que quedaron en otra
  // fecha (otra partición). Sin esto, un aplazamiento duplicaría el timeline:
  // el upsert de abajo no los encuentra (otra match_date en la clave única) y
  // el DELETE final está acotado a la partición actual. Idempotente por match.
  await client.query(
    `DELETE FROM match_events WHERE match_id = $1 AND match_date <> $2`,
    [matchId, matchDate]
  );

  // Postgres no permite que un ON CONFLICT DO UPDATE toque la misma fila dos
  // veces en la misma sentencia. El parser ya desambigua las colisiones por
  // contenido (#375 P3-2), pero otras fuentes podrían repetir la clave.
  const rows = dedupeMatchEventsBySourceRef(events);
  if (rows.length < events.length) {
    // De una clave repetida sólo puede guardarse un evento. No perdemos el otro
    // en silencio: queda el aviso (y se conserva el más completo).
    log.warn(
      { matchId, recibidos: events.length, unicos: rows.length },
      'replaceMatchEvents: colisión de source_ref; se conserva el evento más completo'
    );
  }

  // EQUIPOS INTRUSOS (#325): un evento sólo puede pertenecer a uno de los dos
  // equipos del cruce. Si la resolución de refs apunta a otro equipo (p. ej. el
  // primer equipo del club en la ficha de un filial), el timeline mostraría
  // goles falsos que además no cuadran con el marcador. "Sin equipo" es mejor
  // dato que equipo equivocado: se guarda NULL y queda el aviso.
  let intrusos = 0;
  for (const ev of rows) {
    if (
      ev.teamId != null &&
      ev.teamId !== match.home_team_id &&
      ev.teamId !== match.away_team_id
    ) {
      ev.teamId = null;
      intrusos++;
    }
  }
  if (intrusos > 0) {
    log.warn(
      { matchId, eventos: rows.length, sinEquipo: intrusos },
      'replaceMatchEvents: eventos con un team_id fuera del cruce (home/away) — guardados sin equipo (#325)'
    );
  }

  const values: unknown[] = [];
  const placeholders: string[] = [];
  let idx = 1;

  for (const ev of rows) {
    placeholders.push(
      `($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`
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
      ev.scrapedAt ?? null,
      matchDate
    );
  }

  await client.query(
    `INSERT INTO match_events
       (match_id, team_id, player_id, event_type, minute, period, clock, detail, source_id, source_ref, scraped_at, match_date)
     VALUES ${placeholders.join(', ')}
     ON CONFLICT (match_id, source_ref, match_date) WHERE source_ref IS NOT NULL
     DO UPDATE SET
       team_id    = EXCLUDED.team_id,
       player_id  = EXCLUDED.player_id,
       event_type = EXCLUDED.event_type,
       minute     = EXCLUDED.minute,
       period     = EXCLUDED.period,
       clock      = EXCLUDED.clock,
       detail     = EXCLUDED.detail,
       source_id  = EXCLUDED.source_id,
       scraped_at = EXCLUDED.scraped_at`,
    values
  );

  // Eventos que la ficha ya no lista (correcciones del acta): fuera. match_date
  // acota el DELETE a la partición del partido (poda), en vez de barrer todas.
  await client.query(
    `DELETE FROM match_events
     WHERE match_id = $1
       AND match_date = $2
       AND (source_ref IS NULL OR source_ref <> ALL($3::text[]))`,
    [matchId, matchDate, rows.map((e) => e.sourceRef)]
  );
}

// ── Alineaciones ─────────────────────────────────────────────────────────────

export interface UpsertMatchLineupInput {
  isHome: boolean;
  jerseyNumber?: number;
  playerName: string;
  /** Nombre de pila tal como lo marca el acta (C1). Solo para dar de alta al jugador. */
  playerFirstName?: string;
  isGoalkeeper?: boolean;
  isStarter?: boolean;
  isCaptain?: boolean;
  goals?: number;
  assists?: number;
  playerId?: string;
  /** Ref del acta del jugador (#219): vinculación exacta sin heurística. */
  playerSourceRef?: string;
  /** Cuerpo técnico: 'E1' | 'E2' | 'A' | 'D'. NULL/undefined = jugador. */
  role?: string;
  sourceRef?: string;
  scrapedAt?: Date;
}

/**
 * Reemplaza la alineación completa de un partido (idempotente por re-scrape).
 *
 * team_id (#212): la columna estaba muerta (100% NULL) pese a existir en el
 * esquema — las queries que quieren goles POR EQUIPO desde alineaciones no
 * podían usarla. Se rellena aquí desde el cruce del partido (is_home →
 * home/away), igual que replaceMatchEvents resuelve el lado, para que ningún
 * caller tenga que pasarla.
 */
export async function replaceMatchLineups(
  matchId: string,
  lineups: UpsertMatchLineupInput[],
  client: pg.PoolClient | typeof db = db
): Promise<void> {
  await client.query('DELETE FROM match_lineups WHERE match_id = $1', [matchId]);
  if (lineups.length === 0) return;

  const { rows: teams } = await client.query<{ home_team_id: string | null; away_team_id: string | null }>(
    'SELECT home_team_id, away_team_id FROM matches WHERE id = $1',
    [matchId]
  );
  const homeTeamId = teams[0]?.home_team_id ?? null;
  const awayTeamId = teams[0]?.away_team_id ?? null;

  const values: unknown[] = [];
  const placeholders: string[] = [];
  let idx = 1;

  for (const l of lineups) {
    placeholders.push(
      `($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`
    );
    values.push(
      matchId,
      l.isHome,
      l.isHome ? homeTeamId : awayTeamId,
      l.jerseyNumber ?? null,
      l.playerName,
      l.isGoalkeeper ?? false,
      l.isStarter ?? false,
      l.isCaptain ?? false,
      l.goals ?? 0,
      l.assists ?? 0,
      l.playerId ?? null,
      l.playerSourceRef ?? null,
      l.role ?? null,
      l.sourceRef ?? null,
      l.scrapedAt ?? null
    );
  }

  await client.query(
    `INSERT INTO match_lineups
       (match_id, is_home, team_id, jersey_number, player_name, is_goalkeeper, is_starter, is_captain, goals, assists, player_id, player_source_ref, role, source_ref, scraped_at)
     VALUES ${placeholders.join(', ')}
     ON CONFLICT (match_id, is_home, player_name) DO NOTHING`,
    values
  );
}

/**
 * Elimina placeholders sintéticos obsoletos:
 *  1. El que ya tiene un partido real del mismo cruce y fecha (o sin fecha).
 *  2. Sintéticos DUPLICADOS del mismo cruce y día: la ref sintética incluye el
 *     `scheduledAt`, así que cuando la fuente publicó la hora del partido se creó
 *     una fila nueva (p. ej. 16:00) y quedó la vieja a medianoche (00:00). Gana el
 *     más reciente (o el que tiene hora frente al de medianoche).
 *  3. Sintéticos pasados (>6h) que nunca llegaron a partido real.
 * Misma lógica que cleanup-synthetic-dupes.ts. Lo llaman el calendario FEP
 * (global) y World Skate tras cada carga (acotado a su temporada: un cambio de
 * hora — o la corrección de zona horaria — deja el sintético viejo al lado).
 */
export async function reconcileSyntheticMatches(seasonId: string | null = null): Promise<number> {
  const scope = [seasonId];
  // Cada borrado deja su redirección al partido que lo sustituye (F1-7): la URL
  // del placeholder (compartida, indexada) pasa a llevar al partido real.
  const dupes = await db.query<{ n: number }>(
    `WITH del AS (
     DELETE FROM matches s
     USING matches r
     WHERE s.source_ref LIKE 'synthetic:%'
       AND r.source_ref NOT LIKE 'synthetic:%'
       AND r.season_id    = s.season_id
       AND r.home_team_id = s.home_team_id
       AND r.away_team_id = s.away_team_id
       -- Comparar el DÍA en hora española: un placeholder a las 00:00 (Madrid)
       -- y el partido real a las 20:30 caen en días UTC distintos y no casaban.
       AND (
         (r.scheduled_at AT TIME ZONE 'Europe/Madrid')::date
           = (s.scheduled_at AT TIME ZONE 'Europe/Madrid')::date
         -- Placeholder SIN fecha: se elimina solo si hay UN único partido real
         -- del cruce (con dos mangas reales no sabemos a cuál corresponde).
         OR (s.scheduled_at IS NULL AND (
               SELECT count(*) FROM matches r2
                WHERE r2.season_id = s.season_id AND r2.home_team_id = s.home_team_id
                  AND r2.away_team_id = s.away_team_id AND r2.source_ref NOT LIKE 'synthetic:%') = 1)
       )
       AND ($1::uuid IS NULL OR s.season_id = $1::uuid)
     RETURNING s.id AS old_id, r.id AS new_id
     ), ins AS (
       INSERT INTO entity_redirects (entity_type, old_id, new_id, reason)
       SELECT DISTINCT ON (old_id) 'match', old_id, new_id, 'synthetic-adopted' FROM del
       ON CONFLICT (entity_type, old_id) DO UPDATE SET new_id = EXCLUDED.new_id, reason = EXCLUDED.reason
     )
     SELECT count(DISTINCT old_id)::int AS n FROM del`, scope
  );
  const stale = await db.query(
    `DELETE FROM matches
     WHERE source_ref LIKE 'synthetic:%'
       AND status = 'scheduled'
       AND scheduled_at < NOW() - INTERVAL '6 hours'
       AND ($1::uuid IS NULL OR season_id = $1::uuid)
     RETURNING id`, scope
  );
  // Sintéticos DUPLICADOS del mismo cruce y día (la ref incluye la hora, así que
  // un cambio de hora de la fuente creaba una fila nueva y dejaba la vieja).
  const synDupes = await db.query<{ n: number }>(
    `WITH del AS (
     DELETE FROM matches s
     USING matches r
     WHERE s.source_ref LIKE 'synthetic:%'
       AND r.source_ref LIKE 'synthetic:%'
       AND s.id <> r.id
       AND r.season_id    = s.season_id
       AND r.home_team_id = s.home_team_id
       AND r.away_team_id = s.away_team_id
       AND (r.scheduled_at AT TIME ZONE 'Europe/Madrid')::date
           = (s.scheduled_at AT TIME ZONE 'Europe/Madrid')::date
       AND (
         -- el placeholder de medianoche (solo fecha) cede ante el que tiene hora
         ((s.scheduled_at AT TIME ZONE 'Europe/Madrid')::time = TIME '00:00'
          AND (r.scheduled_at AT TIME ZONE 'Europe/Madrid')::time <> TIME '00:00')
         -- o cualquier sintético más reciente supera a uno más viejo
         OR (r.scraped_at > s.scraped_at)
       )
       AND ($1::uuid IS NULL OR s.season_id = $1::uuid)
     RETURNING s.id AS old_id, r.id AS new_id
     ), ins AS (
       INSERT INTO entity_redirects (entity_type, old_id, new_id, reason)
       SELECT DISTINCT ON (old_id) 'match', old_id, new_id, 'synthetic-replaced' FROM del
       ON CONFLICT (entity_type, old_id) DO UPDATE SET new_id = EXCLUDED.new_id, reason = EXCLUDED.reason
     )
     SELECT count(DISTINCT old_id)::int AS n FROM del`, scope
  );
  return (dupes.rows[0]?.n ?? 0) + (synDupes.rows[0]?.n ?? 0) + (stale.rowCount ?? 0);
}

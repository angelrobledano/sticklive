import { Hono } from 'hono';
import { db } from '@sports/db';

export const liveRouter = new Hono();

interface LiveMatchRow {
  id: string;
  season_id: string;
  round_id: string | null;
  home_score: number | null;
  away_score: number | null;
  status: string;
  scheduled_at: Date | null;
  started_at: Date | null;
  venue_name: string | null;
  venue_city: string | null;
  source_ref: string | null;
  // equipo local
  home_team_id: string;
  home_team_name: string;
  home_team_short_name: string | null;
  home_team_logo_url: string | null;
  // equipo visitante
  away_team_id: string;
  away_team_name: string;
  away_team_short_name: string | null;
  away_team_logo_url: string | null;
}

function mapLiveRow(row: LiveMatchRow) {
  return {
    id:          row.id,
    seasonId:    row.season_id,
    roundId:     row.round_id,
    status:      row.status,
    scheduledAt: row.scheduled_at,
    startedAt:   row.started_at,
    venue:       row.venue_name
      ? { name: row.venue_name, city: row.venue_city }
      : null,
    score: {
      home: row.home_score,
      away: row.away_score,
    },
    homeTeam: {
      id:        row.home_team_id,
      name:      row.home_team_name,
      shortName: row.home_team_short_name,
      logoUrl:   row.home_team_logo_url,
    },
    awayTeam: {
      id:        row.away_team_id,
      name:      row.away_team_name,
      shortName: row.away_team_short_name,
      logoUrl:   row.away_team_logo_url,
    },
  };
}

/**
 * GET /matches/live
 * Devuelve todos los partidos con status = 'live', enriquecidos con los
 * datos de equipo local y visitante (nombre, escudo).
 */
liveRouter.get('/live', async (c) => {
  try {
    const result = await db.query<LiveMatchRow>(`
      SELECT
        m.id,
        m.season_id,
        m.round_id,
        m.home_score,
        m.away_score,
        m.status,
        m.scheduled_at,
        m.started_at,
        m.venue_name,
        m.venue_city,
        m.source_ref,
        -- equipo local
        ht.id           AS home_team_id,
        ht.name         AS home_team_name,
        ht.short_name   AS home_team_short_name,
        ht.logo_url     AS home_team_logo_url,
        -- equipo visitante
        at.id           AS away_team_id,
        at.name         AS away_team_name,
        at.short_name   AS away_team_short_name,
        at.logo_url     AS away_team_logo_url
      FROM matches m
      LEFT JOIN teams ht ON ht.id = m.home_team_id
      LEFT JOIN teams at ON at.id = m.away_team_id
      WHERE m.status = 'live'
      ORDER BY m.started_at ASC NULLS LAST
    `);

    const matches = result.rows.map(mapLiveRow);
    return c.json({ count: matches.length, matches });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ error: 'Database error', detail: message }, 500);
  }
});

/**
 * GET /matches/current
 * Devuelve todos los partidos (scheduled + live + finished) de las
 * temporadas marcadas como is_current=true. Permite a la home page
 * mostrar partidos de TODAS las competiciones activas sin depender
 * de un único SEASON_ID hardcodeado.
 */
liveRouter.get('/current', async (c) => {
  try {
    // Ventana temporal: en vez de devolver TODO el calendario de todas las
    // temporadas actuales (que crece sin límite al escalar competiciones,
    // auditoría A2), se acota a [hoy-8d, hoy+15d] por defecto. La home muestra
    // hoy ± ~2 semanas, así que es suficiente. Override opcional con ?days= o
    // ?from=&to= (ISO). Tope de seguridad de 120 días.
    // Ventana por defecto: hoy-8d .. hoy+15d. Solo si llega ?days= se usa una
    // ventana simétrica de N días (OJO: antes esto colapsaba a ±1 día cuando NO
    // venía el parámetro, dejando la home casi vacía — bug corregido).
    const daysRaw = c.req.query('days');
    const daysN = daysRaw ? Math.min(120, Math.max(1, Number(daysRaw) || 0)) : 0;
    const back = daysN || 8;
    const fwd = daysN || 15;
    const isISO = (s: string | undefined) => !!s && /^\d{4}-\d{2}-\d{2}/.test(s);
    const fromQ = c.req.query('from');
    const toQ = c.req.query('to');

    let where = '';
    const params: unknown[] = [];
    if (isISO(fromQ) && isISO(toQ)) {
      params.push(fromQ, toQ);
      where = `AND m.scheduled_at >= $1::timestamptz AND m.scheduled_at < ($2::timestamptz + INTERVAL '1 day')`;
    } else {
      where = `AND m.scheduled_at >= NOW() - INTERVAL '${back} days'
               AND m.scheduled_at <  NOW() + INTERVAL '${fwd} days'`;
    }

    const result = await db.query<LiveMatchRow>(`
      SELECT
        m.id, m.season_id, m.round_id,
        m.home_score, m.away_score, m.status,
        m.scheduled_at, m.started_at, m.venue_name, m.venue_city, m.source_ref,
        ht.id AS home_team_id, ht.name AS home_team_name,
        ht.short_name AS home_team_short_name, ht.logo_url AS home_team_logo_url,
        at.id AS away_team_id, at.name AS away_team_name,
        at.short_name AS away_team_short_name, at.logo_url AS away_team_logo_url
      FROM matches m
      JOIN seasons s ON s.id = m.season_id AND s.is_current = true
      LEFT JOIN teams ht ON ht.id = m.home_team_id
      LEFT JOIN teams at ON at.id = m.away_team_id
      WHERE m.status IN ('scheduled', 'live', 'finished')
        ${where}
      ORDER BY m.scheduled_at ASC NULLS LAST
    `, params);

    const matches = result.rows.map(mapLiveRow);
    return c.json({ count: matches.length, matches });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ error: 'Database error', detail: message }, 500);
  }
});

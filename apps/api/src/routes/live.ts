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

    const matches = result.rows.map((row) => ({
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
        id:       row.home_team_id,
        name:     row.home_team_name,
        shortName: row.home_team_short_name,
        logoUrl:  row.home_team_logo_url,
      },
      awayTeam: {
        id:       row.away_team_id,
        name:     row.away_team_name,
        shortName: row.away_team_short_name,
        logoUrl:  row.away_team_logo_url,
      },
    }));

    return c.json({ count: matches.length, matches });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ error: 'Database error', detail: message }, 500);
  }
});

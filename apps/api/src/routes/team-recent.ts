import { Hono } from 'hono';
import { db } from '@sports/db';
import { isUuid } from '../lib/uuid.js';
import { captureRouteError } from '../lib/route-error.js';

export const teamRecentRouter = new Hono();

interface RecentRow {
  id: string;
  date: Date | null;
  home_team_id: string;
  home_team_name: string;
  home_team_short_name: string | null;
  home_team_logo_url: string | null;
  away_team_id: string;
  away_team_name: string;
  away_team_short_name: string | null;
  away_team_logo_url: string | null;
  home_score: number;
  away_score: number;
  competition_id: string;
  competition_name: string;
  competition_short_name: string | null;
  round_number: number | null;
}

/**
 * GET /teams/:id/recent?limit=5 (C9)
 * Últimos partidos terminados del equipo en TODAS las competiciones. La ficha
 * de equipo carga una temporada; la previa necesita el histórico reciente
 * completo para no enseñar sólo la liga actual.
 */
teamRecentRouter.get('/:id/recent', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'Not found' }, 404);
  const requested = Number(c.req.query('limit') ?? 5);
  const limit = Number.isFinite(requested) ? Math.min(10, Math.max(1, Math.trunc(requested))) : 5;

  try {
    const result = await db.query<RecentRow>(`
      SELECT m.id,
             COALESCE(m.finished_at, m.scheduled_at) AS date,
             ht.id AS home_team_id, COALESCE(ht.display_name, ht.name) AS home_team_name,
             ht.short_name AS home_team_short_name, ht.logo_url AS home_team_logo_url,
             at.id AS away_team_id, COALESCE(at.display_name, at.name) AS away_team_name,
             at.short_name AS away_team_short_name, at.logo_url AS away_team_logo_url,
             m.home_score, m.away_score,
             c.id AS competition_id, c.name AS competition_name,
             c.short_name AS competition_short_name,
             r.number AS round_number
        FROM matches m
        JOIN seasons s ON s.id = m.season_id
        JOIN competitions c ON c.id = s.competition_id
        JOIN teams ht ON ht.id = m.home_team_id
        JOIN teams at ON at.id = m.away_team_id
        LEFT JOIN rounds r ON r.id = m.round_id
       WHERE (m.home_team_id = $1 OR m.away_team_id = $1)
         AND m.status = 'finished'
         AND s.data_quality = 'ok' AND c.data_quality = 'ok'
         AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
       ORDER BY COALESCE(m.finished_at, m.scheduled_at) DESC NULLS LAST
       LIMIT $2`, [id, limit]);

    return c.json({
      matches: result.rows.map((r) => ({
        id: r.id,
        date: r.date ? new Date(r.date).toISOString() : null,
        homeTeamId: r.home_team_id,
        homeName: r.home_team_name,
        homeShortName: r.home_team_short_name,
        homeLogoUrl: r.home_team_logo_url,
        awayTeamId: r.away_team_id,
        awayName: r.away_team_name,
        awayShortName: r.away_team_short_name,
        awayLogoUrl: r.away_team_logo_url,
        homeScore: r.home_score,
        awayScore: r.away_score,
        competitionId: r.competition_id,
        competitionName: r.competition_name,
        competitionShortName: r.competition_short_name,
        roundNumber: r.round_number,
      })),
    });
  } catch (err) {
    captureRouteError(err, 'GET /teams/:id/recent');
    return c.json({ error: 'Database error' }, 500);
  }
});

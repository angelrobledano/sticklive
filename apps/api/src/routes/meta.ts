import { Hono } from 'hono';
import { db } from '@sports/db';
import { logger } from '@sports/logger';

/**
 * GET /meta/sitemap — ids para construir el sitemap de la web.
 * Acotado: jugadores con actividad y partidos recientes/próximos.
 */
export const metaRouter = new Hono();

metaRouter.get('/sitemap', async (c) => {
  try {
    const [comps, teams, players, matches] = await Promise.all([
      db.query<{ id: string }>(`SELECT id FROM competitions`),
      db.query<{ id: string }>(`SELECT id FROM teams`),
      // Solo jugadores con presencia en alineaciones (los demás no tienen ficha útil)
      db.query<{ id: string }>(`
        SELECT DISTINCT p.id FROM players p
        JOIN match_lineups ml ON ml.player_id = p.id
        LIMIT 10000
      `),
      // Partidos: últimos 60 días + próximos (las fichas viejas entran por los equipos)
      db.query<{ id: string }>(`
        SELECT id FROM matches
        WHERE scheduled_at > NOW() - INTERVAL '60 days'
        ORDER BY scheduled_at DESC
        LIMIT 3000
      `),
    ]);

    c.header('Cache-Control', 'public, max-age=3600');
    return c.json({
      competitions: comps.rows.map((r) => r.id),
      teams:        teams.rows.map((r) => r.id),
      players:      players.rows.map((r) => r.id),
      matches:      matches.rows.map((r) => r.id),
    });
  } catch (err) {
    logger.error({ err }, '[meta] error');
    return c.json({ error: 'Database error' }, 500);
  }
});

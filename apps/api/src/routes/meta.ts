import { Hono } from 'hono';
import { db } from '@sports/db';
import { logger } from '@sports/logger';
import { captureRouteError } from '../lib/route-error.js';

/**
 * GET /meta/sitemap — ids para construir el sitemap de la web.
 * Acotado: jugadores con actividad y partidos recientes/próximos.
 */
export const metaRouter = new Hono();

metaRouter.get('/sitemap', async (c) => {
  try {
    // #337: se devuelven también las fechas de DATOS para que el sitemap emita un
    // `lastmod` real (no el timestamp de generación). El cliente tolera ambas
    // formas (id suelto u objeto) por retrocompatibilidad.
    const [comps, teams, players, matches] = await Promise.all([
      db.query<{ id: string; updated_at: Date }>(
        `SELECT id, updated_at FROM competitions
          WHERE data_quality = 'ok' AND archived_at IS NULL`
      ),
      db.query<{ id: string; updated_at: Date }>(`SELECT id, updated_at FROM teams`),
      // Solo jugadores con presencia en alineaciones (los demás no tienen ficha útil)
      db.query<{ id: string; updated_at: Date }>(`
        SELECT DISTINCT p.id, p.updated_at FROM players p
        JOIN match_lineups ml ON ml.player_id = p.id
        LIMIT 10000
      `),
      // Partidos: últimos 60 días + próximos (las fichas viejas entran por los equipos)
      db.query<{ id: string; updated_at: Date; finished_at: Date | null; scheduled_at: Date | null }>(`
        SELECT m.id, m.updated_at, m.finished_at, m.scheduled_at
          FROM matches m
          JOIN seasons s      ON s.id = m.season_id
          JOIN competitions c ON c.id = s.competition_id
         WHERE m.scheduled_at > NOW() - INTERVAL '60 days'
           AND s.data_quality = 'ok'
           AND c.data_quality = 'ok'
         ORDER BY m.scheduled_at DESC
         LIMIT 3000
      `),
    ]);

    c.header('Cache-Control', 'public, max-age=3600');
    return c.json({
      competitions: comps.rows.map((r) => ({ id: r.id, updatedAt: r.updated_at })),
      teams:        teams.rows.map((r) => ({ id: r.id, updatedAt: r.updated_at })),
      players:      players.rows.map((r) => ({ id: r.id, updatedAt: r.updated_at })),
      matches:      matches.rows.map((r) => ({
        id: r.id, updatedAt: r.updated_at, finishedAt: r.finished_at, scheduledAt: r.scheduled_at,
      })),
    });
  } catch (err) {
    captureRouteError(err, 'meta] error');
    logger.error({ err }, '[meta] error');
    return c.json({ error: 'Database error' }, 500);
  }
});

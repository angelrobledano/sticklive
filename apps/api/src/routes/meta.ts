import { Hono } from 'hono';
import { db } from '@sports/db';
import { logger } from '@sports/logger';
import { captureRouteError } from '../lib/route-error.js';
import { shouldAlertSitemapDrop, sitemapDropPct } from '../lib/sitemap-state.js';

/**
 * GET /meta/sitemap — ids para construir el sitemap de la web.
 * Criterios de elegibilidad (F1-3/F1-4 de docs/AUDITORIA_SEO_2026-10-16.md):
 * competiciones visibles con partidos, equipos con partidos en temporadas
 * visibles, jugadores de competiciones `top_tier` y partidos de -60/+14 días.
 */
export const metaRouter = new Hono();

metaRouter.get('/sitemap', async (c) => {
  try {
    // #337: se devuelven también las fechas de DATOS para que el sitemap emita un
    // `lastmod` real (no el timestamp de generación). El cliente tolera ambas
    // formas (id suelto u objeto) por retrocompatibilidad.
    const [comps, teams, players, matches, seasons] = await Promise.all([
      db.query<{ id: string; updated_at: Date }>(`
        SELECT c.id, c.updated_at
          FROM competitions c
         WHERE c.data_quality = 'ok'
           AND c.archived_at IS NULL
           AND EXISTS (
             SELECT 1 FROM seasons s
              WHERE s.competition_id = c.id
                AND s.data_quality = 'ok'
                AND EXISTS (SELECT 1 FROM matches m WHERE m.season_id = s.id)
           )
      `),
      // F1-4: solo equipos con algún partido en una temporada visible. Los que
      // no tienen ninguno (selecciones autonómicas sin datos, residuos de
      // resolución de entidades) son fichas vacías: siguen accesibles por URL,
      // pero no se declaran.
      db.query<{ id: string; updated_at: Date }>(`
        SELECT t.id, t.updated_at
          FROM teams t
         WHERE (
           SELECT count(*)
             FROM matches m
             JOIN seasons s      ON s.id = m.season_id
             JOIN competitions c ON c.id = s.competition_id
            WHERE (m.home_team_id = t.id OR m.away_team_id = t.id)
              AND s.data_quality = 'ok'
              AND c.data_quality = 'ok'
         ) >= 3
      `),
      // F1-4: jugadores con alineación en una competición de máxima categoría
      // (`competitions.top_tier`, migración 074 — decisión de producto del
      // 17/10/2026). Orden determinista para que el LIMIT no publique un
      // conjunto distinto en cada generación.
      db.query<{ id: string; updated_at: Date }>(`
        SELECT p.id, p.updated_at
          FROM players p
         WHERE (
           SELECT count(DISTINCT ml.match_id)
             FROM match_lineups ml
             JOIN matches m      ON m.id = ml.match_id
             JOIN seasons s      ON s.id = m.season_id
             JOIN competitions c ON c.id = s.competition_id
            WHERE ml.player_id = p.id
              AND c.top_tier
              AND s.data_quality = 'ok'
              AND c.data_quality = 'ok'
         ) >= 8
      `),
      // F1-4: partidos de los últimos 60 días y de los próximos 14. Los que están
      // a meses vista solo tienen equipos y hora: entran en el sitemap cuando se
      // acercan (las fichas viejas siguen enlazadas desde equipos y competición).
      db.query<{ id: string; updated_at: Date; finished_at: Date | null; scheduled_at: Date | null }>(`
        SELECT m.id, m.updated_at, m.finished_at, m.scheduled_at
          FROM matches m
          JOIN seasons s      ON s.id = m.season_id
          JOIN competitions c ON c.id = s.competition_id
         WHERE m.scheduled_at > NOW() - INTERVAL '60 days'
           AND m.scheduled_at < NOW() + INTERVAL '14 days'
           AND s.data_quality = 'ok'
           AND c.data_quality = 'ok'
         ORDER BY m.scheduled_at DESC
         LIMIT 3000
      `),
      // F4-5: temporadas cerradas y verificadas con URL permanente indexable.
      // No entran las que aún tienen partidos pendientes ni las ocultas.
      db.query<{ id: string; updated_at: Date }>(`
        SELECT s.id, s.updated_at
          FROM seasons s
          JOIN competitions c ON c.id = s.competition_id
         WHERE s.data_quality = 'ok'
           AND c.data_quality = 'ok'
           AND c.archived_at IS NULL
           AND NOT s.is_current
           AND EXISTS (
             SELECT 1 FROM matches m
              WHERE m.season_id = s.id AND m.status = 'finished'
           )
           AND NOT EXISTS (
             SELECT 1 FROM matches m
              WHERE m.season_id = s.id
                AND m.status IN ('scheduled', 'live', 'halftime', 'overtime', 'penalty_shootout')
           )
      `),
    ]);

    // F1-8: memoria de la última generación. La caída > 20 % se avisa a Sentry,
    // pero el sitemap se sirve igual: la alerta no debe tumbar el endpoint.
    const sections = {
      competitions: comps.rows.length,
      teams: teams.rows.length,
      players: players.rows.length,
      matches: matches.rows.length,
      seasons: seasons.rows.length,
    };
    const total = Object.values(sections).reduce((sum, value) => sum + value, 0);
    try {
      const previousResult = await db.query<{ total: number }>(
        'SELECT total FROM sitemap_state WHERE id = TRUE'
      );
      const previous = previousResult.rows[0]?.total ?? null;
      await db.query(
        `INSERT INTO sitemap_state (id, total, sections)
         VALUES (TRUE, $1, $2)
         ON CONFLICT (id) DO UPDATE
           SET total = EXCLUDED.total, sections = EXCLUDED.sections, updated_at = NOW()`,
        [total, JSON.stringify(sections)]
      );
      if (shouldAlertSitemapDrop(previous, total)) {
        const pct = sitemapDropPct(previous, total);
        const err = new Error(`sitemap: caída del ${pct}% (${previous} → ${total} URLs)`);
        captureRouteError(err, 'meta] sitemap drop');
        logger.error({ previous, total, sections, pct }, '[meta] sitemap cae más del 20 %');
      }
    } catch (err) {
      // La tabla aún no existe en un despliegue a medias o la BD tuvo un bache:
      // el sitemap sigue sirviendo; la falta de snapshot se ve en los logs.
      logger.warn({ err }, '[meta] no se pudo registrar el snapshot del sitemap');
    }

    c.header('Cache-Control', 'public, max-age=3600');
    return c.json({
      competitions: comps.rows.map((r) => ({ id: r.id, updatedAt: r.updated_at })),
      teams:        teams.rows.map((r) => ({ id: r.id, updatedAt: r.updated_at })),
      players:      players.rows.map((r) => ({ id: r.id, updatedAt: r.updated_at })),
      seasons:      seasons.rows.map((r) => ({ id: r.id, updatedAt: r.updated_at })),
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

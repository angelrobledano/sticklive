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
      db.query<{ id: string; slug: string; updated_at: Date }>(`
        SELECT c.id, c.slug, c.updated_at
          FROM competitions c
          JOIN (
            -- Semi-join: una sola pasada por temporadas/partidos en vez de un
            -- EXISTS correlacionado por competición.
            SELECT DISTINCT s.competition_id
              FROM seasons s
              JOIN matches m ON m.season_id = s.id
             WHERE s.data_quality = 'ok'
          ) visible ON visible.competition_id = c.id
         WHERE c.data_quality = 'ok'
           AND c.archived_at IS NULL
      `),
      // F1-4: solo equipos con algún partido en una temporada visible. Los que
      // no tienen ninguno (selecciones autonómicas sin datos, residuos de
      // resolución de entidades) son fichas vacías: siguen accesibles por URL,
      // pero no se declaran.
      // Search Console 31/10/2026: además, solo equipos que juegan la temporada
      // EN CURSO. Un equipo de base de hace dos temporadas es una ficha que
      // Google rastrea y no indexa; sigue accesible y enlazado, sin noindex.
      db.query<{ id: string; updated_at: Date }>(`
        SELECT t.id, t.updated_at
          FROM teams t
          JOIN (
            -- Agrega los dos lados del cruce una sola vez. El COUNT
            -- correlacionado anterior recorría todos los partidos por CADA
            -- equipo (la causa de los >12 s del endpoint).
            SELECT team_id
              FROM (
                SELECT m.home_team_id AS team_id
                  FROM matches m
                  JOIN seasons s      ON s.id = m.season_id
                  JOIN competitions c ON c.id = s.competition_id
                 WHERE s.data_quality = 'ok'
                   AND c.data_quality = 'ok'
                   AND s.is_current
                UNION ALL
                SELECT m.away_team_id
                  FROM matches m
                  JOIN seasons s      ON s.id = m.season_id
                  JOIN competitions c ON c.id = s.competition_id
                 WHERE s.data_quality = 'ok'
                   AND c.data_quality = 'ok'
                   AND s.is_current
              ) sides
             GROUP BY team_id
            HAVING count(*) >= 3
          ) eligible ON eligible.team_id = t.id
      `),
      // F1-4: jugadores con alineación en una competición de máxima categoría
      // (`competitions.top_tier`, migración 074 — decisión de producto del
      // 17/10/2026). Un único GROUP BY sustituye el COUNT(DISTINCT) por jugador.
      db.query<{ id: string; updated_at: Date }>(`
        SELECT p.id, p.updated_at
          FROM players p
          JOIN (
            SELECT ml.player_id
              FROM match_lineups ml
              JOIN matches m      ON m.id = ml.match_id
              JOIN seasons s      ON s.id = m.season_id
              JOIN competitions c ON c.id = s.competition_id
             WHERE c.top_tier
               AND s.data_quality = 'ok'
               AND c.data_quality = 'ok'
             GROUP BY ml.player_id
            HAVING count(DISTINCT ml.match_id) >= 8
          ) eligible ON eligible.player_id = p.id
      `),
      // F1-4: partidos de los últimos 60 días y de los próximos 7 (eran 14:
      // Search Console 31/10/2026, «descubierta, no indexada» en masa). Los que
      // están más lejos solo tienen equipos y hora: entran cuando se acercan.
      // Orden: primero lo jugado (el LIMIT recortaba los recientes, que son los
      // que tienen resultado y acta).
      db.query<{ id: string; updated_at: Date; finished_at: Date | null; scheduled_at: Date | null }>(`
        SELECT m.id, m.updated_at, m.finished_at, m.scheduled_at
          FROM matches m
          JOIN seasons s      ON s.id = m.season_id
          JOIN competitions c ON c.id = s.competition_id
         WHERE m.scheduled_at > NOW() - INTERVAL '60 days'
           AND m.scheduled_at < NOW() + INTERVAL '7 days'
           AND s.data_quality = 'ok'
           AND c.data_quality = 'ok'
         ORDER BY (m.scheduled_at > NOW()), m.scheduled_at DESC
         LIMIT 3000
      `),
      // F4-5: temporadas cerradas y verificadas con URL permanente indexable.
      // No entran las que aún tienen partidos pendientes ni las ocultas.
      db.query<{ id: string; updated_at: Date }>(`
        WITH closed AS MATERIALIZED (
          -- Materializado a propósito: sin esto el planner puede reevaluar el
          -- GROUP BY por cada temporada (lo hacía 664 veces → 8 s).
          SELECT season_id
            FROM matches
           GROUP BY season_id
          HAVING bool_or(status = 'finished')
             AND NOT bool_or(status IN ('scheduled', 'live', 'halftime', 'overtime', 'penalty_shootout'))
        )
        SELECT s.id, s.updated_at
          FROM seasons s
          JOIN competitions c ON c.id = s.competition_id
          JOIN closed cl ON cl.season_id = s.id
         WHERE s.data_quality = 'ok'
           AND c.data_quality = 'ok'
           AND c.archived_at IS NULL
           AND NOT s.is_current
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

    // Plan B1: clubes con alguna sección jugando una temporada en curso visible
    // (la misma regla que `indexable` de GET /clubs/:key). Tolerante: si falla,
    // el sitemap sale sin clubes.
    let clubs: Array<{ id: string; slug: string; updated_at: Date }> = [];
    try {
      const clubRows = await db.query<{ id: string; slug: string; updated_at: Date }>(`
        SELECT cl.id, cl.slug, cl.updated_at
          FROM clubs cl
         WHERE EXISTS (
           SELECT 1
             FROM teams t
             JOIN matches m      ON m.home_team_id = t.id OR m.away_team_id = t.id
             JOIN seasons s      ON s.id = m.season_id
             JOIN competitions c ON c.id = s.competition_id
            WHERE t.club_id = cl.id
              AND t.team_type = 'club'
              AND s.is_current
              AND s.data_quality = 'ok'
              AND c.data_quality = 'ok'
         )
      `);
      clubs = clubRows.rows;
    } catch (err) {
      logger.warn({ err }, '[meta] clubes del sitemap no disponibles');
    }

    // Hubs de país y federación (migración 089): solo los que tienen
    // competiciones visibles. Tolerante: si falla, el sitemap sale sin hubs.
    let hubs: string[] = [];
    try {
      const hubRows = await db.query<{ path: string }>(`
        WITH visible AS (
          SELECT c.organizer, c.country, c.scope
            FROM competitions c
           WHERE c.archived_at IS NULL AND c.data_quality = 'ok'
             AND EXISTS (SELECT 1 FROM seasons s JOIN matches m ON m.season_id = s.id
                          WHERE s.competition_id = c.id AND s.data_quality = 'ok')
        )
        SELECT DISTINCT '/competitions/country/' || lower(COALESCE(f.country, v.country)) AS path
          FROM visible v LEFT JOIN federations f ON f.code = v.organizer
         WHERE v.scope <> 'international'
           AND COALESCE(f.level, 'national') NOT IN ('world', 'continental')
           AND COALESCE(f.country, v.country) ~ '^[A-Za-z]{2}$'
        UNION
        SELECT DISTINCT '/competitions/federation/' || f.slug
          FROM visible v JOIN federations f ON f.code = v.organizer
        ORDER BY 1
      `);
      hubs = hubRows.rows.map((r) => r.path);
    } catch (err) {
      logger.warn({ err }, '[meta] hubs del sitemap no disponibles');
    }

    c.header('Cache-Control', 'public, max-age=3600');
    return c.json({
      hubs,
      clubs:        clubs.map((r) => ({ id: r.id, slug: r.slug, updatedAt: r.updated_at })),
      competitions: comps.rows.map((r) => ({ id: r.id, slug: r.slug, updatedAt: r.updated_at })),
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

import { Hono } from 'hono';
import { db } from '@sports/db';
import { logger } from '@sports/logger';
import { isUuid } from '../lib/uuid.js';

export const competitionsRouter = new Hono();

interface CompetitionRow {
  id: string;
  name: string;
  name_i18n: Record<string, string> | null;
  short_name: string | null;
  slug: string;
  gender: string | null;
  category: string | null;
  country: string | null;
  organizer: string;
  scope: string;
  region: string | null;
  age_category: string;
  season_id: string | null;
  season_name: string | null;
  season_start: string | null;
  season_end: string | null;
  season_is_current: boolean | null;
  team_count: string | null;
  match_count: string | null;
}

/**
 * GET /competitions
 * Lista las competiciones activas con su temporada de referencia.
 *
 * Excluye por defecto:
 *   - competiciones archivadas (archived_at IS NOT NULL)
 *   - competiciones sin ninguna temporada con partidos
 *
 * Query param:
 *   ?include_archived=true -> incluye archivadas (vistas historicas / admin)
 */
competitionsRouter.get('/', async (c) => {
  const includeArchived = c.req.query('include_archived') === 'true';
  const archivedClause = includeArchived ? '' : 'AND comp.archived_at IS NULL';

  try {
    // #333: en vez de dos COUNT correlacionados por cada competición (2 filas
    // × N competiciones), se eligen primero las temporadas de referencia y se
    // agregan los contadores UNA vez, sólo para esas temporadas. El resultado
    // es idéntico (COALESCE 0 cuando una temporada no tiene filas).
    const result = await db.query<CompetitionRow>(`
      WITH picked AS (
        SELECT comp.id AS comp_id, s.id AS season_id
        FROM competitions comp
        JOIN LATERAL (
          SELECT s2.id FROM seasons s2
          WHERE s2.competition_id = comp.id
            AND EXISTS (SELECT 1 FROM matches m WHERE m.season_id = s2.id)
          ORDER BY s2.is_current DESC, s2.start_date DESC NULLS LAST
          LIMIT 1
        ) s ON TRUE
        WHERE TRUE ` + archivedClause + `
      ),
      team_counts AS (
        SELECT st.season_id, COUNT(*)::text AS c
        FROM season_teams st
        WHERE st.season_id IN (SELECT season_id FROM picked)
        GROUP BY st.season_id
      ),
      match_counts AS (
        SELECT m.season_id, COUNT(*)::text AS c
        FROM matches m
        WHERE m.season_id IN (SELECT season_id FROM picked)
        GROUP BY m.season_id
      )
      SELECT
        comp.id, comp.name, comp.name_i18n, comp.short_name, comp.slug,
        comp.gender, comp.category, comp.country,
        comp.organizer, comp.scope, comp.region, comp.age_category,
        s.id         AS season_id,
        s.name       AS season_name,
        s.start_date AS season_start,
        s.end_date   AS season_end,
        s.is_current AS season_is_current,
        COALESCE(tc.c, '0') AS team_count,
        COALESCE(mc.c, '0') AS match_count
      FROM picked p
      JOIN competitions comp ON comp.id = p.comp_id
      JOIN seasons s ON s.id = p.season_id
      LEFT JOIN team_counts tc ON tc.season_id = p.season_id
      LEFT JOIN match_counts mc ON mc.season_id = p.season_id
      ORDER BY comp.name ASC
    `);

    const competitions = result.rows.map((r) => ({
      id:         r.id,
      name:       r.name,
      nameI18n:   r.name_i18n,
      shortName:  r.short_name,
      slug:       r.slug,
      gender:     r.gender,
      category:   r.category,
      country:    r.country,
      organizer:  r.organizer,
      scope:      r.scope,
      region:     r.region,
      ageCategory: r.age_category,
      season: r.season_id ? {
        id:         r.season_id,
        name:       r.season_name,
        startDate:  r.season_start,
        endDate:    r.season_end,
        isCurrent:  r.season_is_current ?? false,
        teamCount:  Number(r.team_count ?? 0),
        matchCount: Number(r.match_count ?? 0),
      } : null,
    }));

    return c.json({ count: competitions.length, competitions });
  } catch (err) {
    logger.error({ err }, '[competitions] GET / error');
    return c.json({ error: 'Database error' }, 500);
  }
});

/**
 * GET /competitions/:id/seasons
 * Historico de temporadas de una competicion (activa o archivada), de mas reciente a mas antigua.
 * Accesible siempre por URL directa independientemente del estado de archivado.
 */
competitionsRouter.get('/:id/seasons', async (c) => {
  const id = c.req.param('id');

  // Un id no-UUID haría fallar el cast a uuid de Postgres y devolvería 500
  // (enlace corrupto/bot) en vez de 404 (#275).
  if (!isUuid(id)) return c.json({ error: 'Not found' }, 404);

  try {
    const result = await db.query<{
      id: string;
      name: string;
      slug: string;
      is_current: boolean;
      start_date: Date | null;
    }>(
      `SELECT id, name, slug, is_current, start_date
        FROM seasons s
        WHERE competition_id = $1
          AND EXISTS (SELECT 1 FROM matches m WHERE m.season_id = s.id)
        ORDER BY start_date DESC NULLS LAST, name DESC`,
      [id]
    );

    if (result.rows.length === 0) return c.json({ error: 'Competition not found or has no seasons' }, 404);

    return c.json({
      seasons: result.rows.map((r) => ({
        id:        r.id,
        name:      r.name,
        slug:      r.slug,
        isCurrent: r.is_current,
      })),
    });
  } catch (err) {
    logger.error({ err }, '[competitions] GET /:id/seasons error');
    return c.json({ error: 'Database error' }, 500);
  }
});

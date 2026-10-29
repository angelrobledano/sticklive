import { Hono } from 'hono';
import { db } from '@sports/db';
import { logger } from '@sports/logger';
import { parseCompetitionKey } from '../lib/competition-key.js';
import { captureRouteError } from '../lib/route-error.js';

export const competitionsRouter = new Hono();

interface CompetitionRow {
  id: string;
  name: string;
  name_i18n: Record<string, string> | null;
  short_name: string | null;
  logo_url: string | null;
  slug: string;
  gender: string | null;
  category: string | null;
  country: string | null;
  organizer: string;
  scope: string;
  region: string | null;
  age_category: string;
  data_quality: string;
  tier: number | null;
  featured_rank: number | null;
  fed_code: string | null;
  fed_slug: string | null;
  fed_name: string | null;
  fed_short_name: string | null;
  fed_level: string | null;
  fed_parent_code: string | null;
  fed_country: string | null;
  fed_region: string | null;
  season_id: string | null;
  season_name: string | null;
  season_start: string | null;
  season_end: string | null;
  season_is_current: boolean | null;
  team_count: string | null;
  match_count: string | null;
  first_match_at: Date | string | null;
  last_match_at: Date | string | null;
  next_match_at: Date | string | null;
  live_matches: number | null;
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
            AND s2.data_quality = 'ok'
            AND EXISTS (SELECT 1 FROM matches m WHERE m.season_id = s2.id)
          ORDER BY s2.is_current DESC, s2.start_date DESC NULLS LAST
          LIMIT 1
        ) s ON TRUE
        WHERE comp.data_quality = 'ok' ` + archivedClause + `
      ),
      team_counts AS (
        SELECT st.season_id, COUNT(*)::text AS c
        FROM season_teams st
        WHERE st.season_id IN (SELECT season_id FROM picked)
        GROUP BY st.season_id
      ),
      match_counts AS (
        SELECT m.season_id, COUNT(*)::text AS c,
          MIN(m.scheduled_at) AS first_at,
          MAX(m.scheduled_at) AS last_at,
          MIN(m.scheduled_at) FILTER (WHERE m.status = 'scheduled' AND m.scheduled_at >= NOW()) AS next_at,
          COUNT(*) FILTER (WHERE m.status IN ('live', 'halftime', 'overtime', 'penalty_shootout'))::int AS live
        FROM matches m
        WHERE m.season_id IN (SELECT season_id FROM picked)
        GROUP BY m.season_id
      )
      SELECT
        comp.id, comp.name, comp.name_i18n, comp.short_name, comp.logo_url, comp.slug,
        comp.gender, comp.category, comp.country, comp.data_quality,
        comp.organizer, comp.scope, comp.region, comp.age_category,
        comp.tier, comp.featured_rank,
        f.code AS fed_code, f.slug AS fed_slug, f.name AS fed_name,
        f.short_name AS fed_short_name, f.level AS fed_level,
        f.parent_code AS fed_parent_code, f.country AS fed_country, f.region AS fed_region,
        s.id         AS season_id,
        s.name       AS season_name,
        s.start_date AS season_start,
        s.end_date   AS season_end,
        s.is_current AS season_is_current,
        COALESCE(tc.c, '0') AS team_count,
        COALESCE(mc.c, '0') AS match_count,
        mc.first_at AS first_match_at, mc.last_at AS last_match_at, mc.next_at AS next_match_at,
        COALESCE(mc.live, 0) AS live_matches
      FROM picked p
      JOIN competitions comp ON comp.id = p.comp_id
      JOIN seasons s ON s.id = p.season_id
      LEFT JOIN team_counts tc ON tc.season_id = p.season_id
      LEFT JOIN match_counts mc ON mc.season_id = p.season_id
      LEFT JOIN federations f ON f.code = comp.organizer
      ORDER BY comp.name ASC
    `);

    const competitions = result.rows.map((r) => ({
      id:         r.id,
      name:       r.name,
      nameI18n:   r.name_i18n,
      shortName:  r.short_name,
      logoUrl:    r.logo_url,
      slug:       r.slug,
      gender:     r.gender,
      category:   r.category,
      country:    r.country,
      organizer:  r.organizer,
      scope:      r.scope,
      region:     r.region,
      ageCategory: r.age_category,
      dataQuality: r.data_quality,
      tier:         r.tier,
      featuredRank: r.featured_rank,
      federation: r.fed_code ? {
        code:       r.fed_code,
        slug:       r.fed_slug,
        name:       r.fed_name,
        shortName:  r.fed_short_name,
        level:      r.fed_level,
        parentCode: r.fed_parent_code,
        country:    r.fed_country,
        region:     r.fed_region,
      } : null,
      season: r.season_id ? {
        id:         r.season_id,
        name:       r.season_name,
        startDate:  r.season_start,
        endDate:    r.season_end,
        isCurrent:  r.season_is_current ?? false,
        teamCount:  Number(r.team_count ?? 0),
        matchCount: Number(r.match_count ?? 0),
        // Calendario de la temporada: la pantalla de competiciones destaca
        // una copa solo cerca de sus fechas y marca las que están en juego.
        firstMatchAt: r.first_match_at ?? null,
        lastMatchAt:  r.last_match_at ?? null,
        nextMatchAt:  r.next_match_at ?? null,
        liveMatches:  Number(r.live_matches ?? 0),
      } : null,
    }));

    return c.json({ count: competitions.length, competitions });
  } catch (err) {
    captureRouteError(err, 'competitions] GET / error');
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
  // Plan A de URLs legibles: el parámetro puede ser el UUID (URLs antiguas) o
  // el slug de la competición. Cualquier otra cosa → 404 sin tocar la BD (#275).
  const key = parseCompetitionKey(c.req.param('id'));
  if (!key) return c.json({ error: 'Not found' }, 404);

  try {
    const result = await db.query<{
      id: string;
      name: string;
      slug: string;
      is_current: boolean;
      start_date: Date | null;
      competition_id: string;
      competition_slug: string;
    }>(
      `SELECT s.id, s.name, s.slug, s.is_current, s.start_date,
              c.id AS competition_id, c.slug AS competition_slug
        FROM seasons s
        JOIN competitions c ON c.id = s.competition_id
        WHERE ${key.by === 'id' ? 'c.id = $1' : 'c.slug = $1'}
          AND s.data_quality = 'ok'
          AND c.data_quality = 'ok'
          AND EXISTS (SELECT 1 FROM matches m WHERE m.season_id = s.id)
        ORDER BY s.start_date DESC NULLS LAST, s.name DESC`,
      [key.value]
    );

    if (result.rows.length === 0) return c.json({ error: 'Competition not found or has no seasons' }, 404);

    const first = result.rows[0]!;
    return c.json({
      // Identidad canónica: la web la usa para redirigir el UUID al slug.
      competition: { id: first.competition_id, slug: first.competition_slug },
      seasons: result.rows.map((r) => ({
        id:        r.id,
        name:      r.name,
        slug:      r.slug,
        isCurrent: r.is_current,
      })),
    });
  } catch (err) {
    captureRouteError(err, 'competitions] GET /:id/seasons error');
    logger.error({ err }, '[competitions] GET /:id/seasons error');
    return c.json({ error: 'Database error' }, 500);
  }
});

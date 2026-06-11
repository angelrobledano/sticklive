import { Hono } from 'hono';
import { db } from '@sports/db';

export const competitionsRouter = new Hono();

interface CompetitionRow {
  id: string;
  name: string;
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
  team_count: string | null;
  match_count: string | null;
}

/**
 * GET /competitions
 * Lista las competiciones con su temporada de referencia (la actual si
 * existe; si no, la más reciente — las históricas también se listan).
 */
competitionsRouter.get('/', async (c) => {
  try {
    const result = await db.query<CompetitionRow>(`
      SELECT
        comp.id, comp.name, comp.short_name, comp.slug,
        comp.gender, comp.category, comp.country,
        comp.organizer, comp.scope, comp.region, comp.age_category,
        s.id   AS season_id,
        s.name AS season_name,
        (SELECT COUNT(*)::text FROM season_teams st WHERE st.season_id = s.id) AS team_count,
        (SELECT COUNT(*)::text FROM matches m WHERE m.season_id = s.id)       AS match_count
      FROM competitions comp
      JOIN LATERAL (
        SELECT id, name FROM seasons s2
        WHERE s2.competition_id = comp.id
        ORDER BY s2.is_current DESC, s2.start_date DESC NULLS LAST
        LIMIT 1
      ) s ON TRUE
      ORDER BY comp.name ASC
    `);

    const competitions = result.rows.map((r) => ({
      id:         r.id,
      name:       r.name,
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
        teamCount:  Number(r.team_count ?? 0),
        matchCount: Number(r.match_count ?? 0),
      } : null,
    }));

    return c.json({ count: competitions.length, competitions });
  } catch (err) {
    console.error('[competitions] GET / error:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ error: 'Database error', detail: message }, 500);
  }
});

/**
 * GET /competitions/:id/seasons
 * Histórico de temporadas de una competición, de más reciente a más antigua.
 */
competitionsRouter.get('/:id/seasons', async (c) => {
  const id = c.req.param('id');
  try {
    const result = await db.query<{
      id: string;
      name: string;
      slug: string;
      is_current: boolean;
      start_date: Date | null;
    }>(`
      SELECT id, name, slug, is_current, start_date
      FROM seasons
      WHERE competition_id = $1
      ORDER BY start_date DESC NULLS LAST, name DESC
    `, [id]);

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
    console.error('[competitions] GET /:id/seasons error:', err);
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: 'Database error', detail: message }, 500);
  }
});

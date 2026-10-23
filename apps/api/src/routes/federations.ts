import { Hono } from 'hono';
import { db } from '@sports/db';
import { logger } from '@sports/logger';
import { captureRouteError } from '../lib/route-error.js';

export const federationsRouter = new Hono();

interface FederationRow {
  code: string;
  slug: string;
  name: string;
  short_name: string;
  level: string;
  parent_code: string | null;
  country: string | null;
  region: string | null;
  website: string | null;
  display_order: number;
  competition_count: string;
}

/**
 * GET /federations
 * Árbol plano de federaciones (world → continental → national → regional),
 * ordenado por display_order, con el nº de competiciones visibles de cada una.
 * El cliente reconstruye el árbol con `parentCode`.
 */
federationsRouter.get('/', async (c) => {
  try {
    const result = await db.query<FederationRow>(`
      SELECT f.code, f.slug, f.name, f.short_name, f.level, f.parent_code,
             f.country, f.region, f.website, f.display_order,
             COUNT(comp.id)::text AS competition_count
      FROM federations f
      LEFT JOIN competitions comp
        ON comp.organizer = f.code
       AND comp.archived_at IS NULL
       AND comp.data_quality = 'ok'
      GROUP BY f.code
      ORDER BY f.display_order, f.name
    `);
    const federations = result.rows.map((r) => ({
      code:             r.code,
      slug:             r.slug,
      name:             r.name,
      shortName:        r.short_name,
      level:            r.level,
      parentCode:       r.parent_code,
      country:          r.country,
      region:           r.region,
      website:          r.website,
      displayOrder:     r.display_order,
      competitionCount: Number(r.competition_count),
    }));
    return c.json({ count: federations.length, federations });
  } catch (err) {
    captureRouteError(err, 'federations] GET / error');
    logger.error({ err }, '[federations] GET / error');
    return c.json({ error: 'Database error' }, 500);
  }
});

import { db } from '../client.js';

/**
 * Federaciones e importancia de competiciones (migración 089), editables desde
 * el panel de admin sin desplegar.
 */

export type FederationLevel = 'world' | 'continental' | 'national' | 'regional';

export interface DbFederation {
  code: string;
  slug: string;
  name: string;
  short_name: string;
  level: FederationLevel;
  parent_code: string | null;
  country: string | null;
  region: string | null;
  website: string | null;
  display_order: number;
  competition_count: string;
}

export interface UpsertFederationInput {
  code: string;
  slug: string;
  name: string;
  shortName: string;
  level: FederationLevel;
  parentCode: string | null;
  country: string | null;
  region: string | null;
  website: string | null;
  displayOrder: number;
}

export async function listFederationsAdmin(): Promise<DbFederation[]> {
  const { rows } = await db.query<DbFederation>(`
    SELECT f.*, COUNT(c.id)::text AS competition_count
      FROM federations f
      LEFT JOIN competitions c ON c.organizer = f.code
     GROUP BY f.code
     ORDER BY f.display_order, f.name`);
  return rows;
}

/** Organizers en uso sin fila en `federations`: lo que falta dar de alta. */
export async function listOrphanOrganizers(): Promise<{ organizer: string; competition_count: string; countries: string[] }[]> {
  const { rows } = await db.query<{ organizer: string; competition_count: string; countries: string[] }>(`
    SELECT c.organizer, COUNT(*)::text AS competition_count,
           array_agg(DISTINCT c.country) AS countries
      FROM competitions c
     WHERE NOT EXISTS (SELECT 1 FROM federations f WHERE f.code = c.organizer)
     GROUP BY c.organizer
     ORDER BY COUNT(*) DESC, c.organizer`);
  return rows;
}

export async function upsertFederation(input: UpsertFederationInput): Promise<DbFederation> {
  const { rows } = await db.query<DbFederation>(`
    INSERT INTO federations (code, slug, name, short_name, level, parent_code, country, region, website, display_order)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    ON CONFLICT (code) DO UPDATE SET
      slug = EXCLUDED.slug, name = EXCLUDED.name, short_name = EXCLUDED.short_name,
      level = EXCLUDED.level, parent_code = EXCLUDED.parent_code, country = EXCLUDED.country,
      region = EXCLUDED.region, website = EXCLUDED.website, display_order = EXCLUDED.display_order,
      updated_at = NOW()
    RETURNING *, '0'::text AS competition_count`,
    [input.code, input.slug, input.name, input.shortName, input.level, input.parentCode,
     input.country, input.region, input.website, input.displayOrder]);
  return rows[0]!;
}

/**
 * Cambia tier / featured_rank. `undefined` = no tocar, `null` = quitar.
 * Devuelve null si la competición no existe.
 */
export async function setCompetitionRanking(
  id: string,
  patch: { tier?: number | null; featuredRank?: number | null },
): Promise<{ id: string; tier: number | null; featured_rank: number | null } | null> {
  const { rows } = await db.query<{ id: string; tier: number | null; featured_rank: number | null }>(`
    UPDATE competitions SET
      tier          = CASE WHEN $2 THEN $3::smallint ELSE tier END,
      featured_rank = CASE WHEN $4 THEN $5::smallint ELSE featured_rank END,
      updated_at    = NOW()
    WHERE id = $1
    RETURNING id, tier, featured_rank`,
    [id, patch.tier !== undefined, patch.tier ?? null, patch.featuredRank !== undefined, patch.featuredRank ?? null]);
  return rows[0] ?? null;
}

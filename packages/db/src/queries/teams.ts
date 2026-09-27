import pg from 'pg';
import { db } from '../client.js';

export interface DbTeam {
  id: string;
  sport_id: string;
  name: string;
  short_name: string | null;
  slug: string;
  city: string | null;
  country: string;
  logo_url: string | null;
  website_url: string | null;
  source_id: string | null;
  source_ref: string | null;
  source_url: string | null;
  alt_source_refs: string[];
  // Columnas añadidas por migraciones posteriores al tipo original (032:
  // team_type/gender/age_category; 044: club_id/squad_level). Opcionales para no
  // romper construcciones existentes; con `SELECT *` llegan siempre.
  team_type?: string | null;
  gender?: string | null;
  age_category?: string | null;
  club_id?: string | null;
  squad_level?: number | null;
  scraped_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface UpsertTeamInput {
  sportId: string;
  name: string;
  shortName?: string;
  slug: string;
  city?: string;
  country: string;
  logoUrl?: string;
  websiteUrl?: string;
  sourceId?: string;
  sourceRef?: string;
  sourceUrl?: string;
  scrapedAt?: Date;
}

export async function upsertTeam(
  input: UpsertTeamInput,
  client: pg.PoolClient | typeof db = db
): Promise<DbTeam> {
  const result = await client.query<DbTeam>(
    `INSERT INTO teams
       (sport_id, name, short_name, slug, city, country, logo_url, website_url,
        source_id, source_ref, source_url, scraped_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (sport_id, slug) DO UPDATE SET
       name       = EXCLUDED.name,
       short_name = COALESCE(EXCLUDED.short_name, teams.short_name),
       city       = COALESCE(EXCLUDED.city,       teams.city),
       logo_url   = COALESCE(EXCLUDED.logo_url,   teams.logo_url),
       source_ref = COALESCE(EXCLUDED.source_ref, teams.source_ref),
       source_url = COALESCE(EXCLUDED.source_url, teams.source_url),
       scraped_at = EXCLUDED.scraped_at,
       updated_at = NOW()
     RETURNING *`,
    [
      input.sportId,
      input.name,
      input.shortName ?? null,
      input.slug,
      input.city ?? null,
      input.country,
      input.logoUrl ?? null,
      input.websiteUrl ?? null,
      input.sourceId ?? null,
      input.sourceRef ?? null,
      input.sourceUrl ?? null,
      input.scrapedAt ?? null,
    ]
  );
  return result.rows[0]!;
}

export async function findTeamBySourceRef(sourceRef: string): Promise<DbTeam | null> {
  // Busca tanto en source_ref principal como en el array alt_source_refs.
  // Esto permite que scrapers con sistemas de IDs distintos (ej: rfep_mc_1.php
  // usa club_44 mientras el calendario usa 3373) resuelvan al mismo equipo.
  const result = await db.query<DbTeam>(
    'SELECT * FROM teams WHERE source_ref = $1 OR $1 = ANY(alt_source_refs)',
    [sourceRef]
  );
  return result.rows[0] ?? null;
}

/**
 * Añade un ref alternativo al array alt_source_refs de un equipo.
 * Idempotente: no duplica si el ref ya existe.
 */
export async function addTeamAltRef(
  teamId: string,
  altRef: string,
  client: pg.PoolClient | typeof db = db
): Promise<void> {
  await client.query(
    `UPDATE teams
     SET alt_source_refs = array_append(alt_source_refs, $2),
         updated_at = NOW()
     WHERE id = $1
       AND NOT ($2 = ANY(alt_source_refs))`,
    [teamId, altRef]
  );
}

export async function findTeamBySlug(sportId: string, slug: string): Promise<DbTeam | null> {
  const result = await db.query<DbTeam>(
    'SELECT * FROM teams WHERE sport_id = $1 AND slug = $2',
    [sportId, slug]
  );
  return result.rows[0] ?? null;
}

/** Actualiza el logo_url de un equipo existente por UUID. */
export async function updateTeamLogoUrl(
  teamId: string,
  logoUrl: string,
  client: pg.PoolClient | typeof db = db
): Promise<void> {
  await client.query(
    `UPDATE teams SET logo_url = $2, updated_at = NOW() WHERE id = $1`,
    [teamId, logoUrl]
  );
}

/** Busqueda por nombre aproximado via pg_trgm. */
export async function findTeamByNameSimilarity(
  sportId: string,
  name: string
): Promise<DbTeam | null> {
  const result = await db.query<DbTeam>(
    `SELECT *, similarity(name, $2) AS sim
     FROM teams
     WHERE sport_id = $1
       AND similarity(name, $2) > 0.4
     ORDER BY sim DESC
     LIMIT 1`,
    [sportId, name]
  );
  return result.rows[0] ?? null;
}

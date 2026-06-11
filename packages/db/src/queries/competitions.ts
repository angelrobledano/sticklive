import pg from 'pg';
import { db } from '../client.js';

export interface DbCompetition {
  id: string;
  sport_id: string;
  name: string;
  short_name: string | null;
  slug: string;
  gender: string | null;
  category: string | null;
  country: string;
  source_id: string | null;
  source_ref: string | null;
  source_url: string | null;
  scraped_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface UpsertCompetitionInput {
  sportId: string;
  name: string;
  shortName?: string;
  slug: string;
  gender?: string;
  category?: string;
  country: string;
  sourceId?: string;
  sourceRef?: string;
  sourceUrl?: string;
  scrapedAt?: Date;
}

/**
 * Upsert de una competición.
 * Clave de conflicto: (sport_id, slug) — identificador natural estable.
 * En caso de conflicto actualiza los campos mutables pero preserva created_at.
 */
export async function upsertCompetition(
  input: UpsertCompetitionInput,
  client: pg.PoolClient | typeof db = db
): Promise<DbCompetition> {
  const result = await client.query<DbCompetition>(
    `INSERT INTO competitions
       (sport_id, name, short_name, slug, gender, category, country,
        source_id, source_ref, source_url, scraped_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (sport_id, slug) DO UPDATE SET
       name        = EXCLUDED.name,
       short_name  = COALESCE(EXCLUDED.short_name, competitions.short_name),
       gender      = COALESCE(EXCLUDED.gender,     competitions.gender),
       category    = COALESCE(EXCLUDED.category,   competitions.category),
       source_ref  = COALESCE(EXCLUDED.source_ref, competitions.source_ref),
       source_url  = COALESCE(EXCLUDED.source_url, competitions.source_url),
       scraped_at  = EXCLUDED.scraped_at,
       updated_at  = NOW()
     RETURNING *`,
    [
      input.sportId,
      input.name,
      input.shortName ?? null,
      input.slug,
      input.gender ?? null,
      input.category ?? null,
      input.country,
      input.sourceId ?? null,
      input.sourceRef ?? null,
      input.sourceUrl ?? null,
      input.scrapedAt ?? null,
    ]
  );
  return result.rows[0]!;
}

export async function findCompetitionBySlug(
  sportId: string,
  slug: string
): Promise<DbCompetition | null> {
  const result = await db.query<DbCompetition>(
    'SELECT * FROM competitions WHERE sport_id = $1 AND slug = $2',
    [sportId, slug]
  );
  return result.rows[0] ?? null;
}

export async function findCompetitionBySourceRef(
  sourceRef: string
): Promise<DbCompetition | null> {
  const result = await db.query<DbCompetition>(
    'SELECT * FROM competitions WHERE source_ref = $1',
    [sourceRef]
  );
  return result.rows[0] ?? null;
}

export async function listCompetitions(sportId?: string): Promise<DbCompetition[]> {
  if (sportId) {
    const result = await db.query<DbCompetition>(
      'SELECT * FROM competitions WHERE sport_id = $1 ORDER BY name',
      [sportId]
    );
    return result.rows;
  }
  const result = await db.query<DbCompetition>('SELECT * FROM competitions ORDER BY name');
  return result.rows;
}

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
  organizer: string;
  scope: string;
  region: string | null;
  age_category: string;
  source_id: string | null;
  source_ref: string | null;
  source_url: string | null;
  scraped_at: Date | null;
  archived_at: Date | null;
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
  organizer?: string;
  scope?: string;
  region?: string;
  ageCategory?: string;
  sourceId?: string;
  sourceRef?: string;
  sourceUrl?: string;
  scrapedAt?: Date;
}

/**
 * Upsert de una competicion.
 * Clave de conflicto: (sport_id, slug).
 * El upsert NO toca archived_at; la reactivacion la maneja el trigger DB.
 */
export async function upsertCompetition(
  input: UpsertCompetitionInput,
  client: pg.PoolClient | typeof db = db
): Promise<DbCompetition> {
  const result = await client.query<DbCompetition>(
    `INSERT INTO competitions
       (sport_id, name, short_name, slug, gender, category, country,
        organizer, scope, region, age_category,
        source_id, source_ref, source_url, scraped_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (sport_id, slug) DO UPDATE SET
       name         = EXCLUDED.name,
       short_name   = COALESCE(EXCLUDED.short_name,   competitions.short_name),
       gender       = COALESCE(EXCLUDED.gender,        competitions.gender),
       category     = COALESCE(EXCLUDED.category,      competitions.category),
       organizer    = COALESCE(EXCLUDED.organizer,     competitions.organizer),
       scope        = COALESCE(EXCLUDED.scope,         competitions.scope),
       region       = COALESCE(EXCLUDED.region,        competitions.region),
       age_category = COALESCE(EXCLUDED.age_category,  competitions.age_category),
       source_ref   = COALESCE(EXCLUDED.source_ref,    competitions.source_ref),
       source_url   = COALESCE(EXCLUDED.source_url,    competitions.source_url),
       scraped_at   = EXCLUDED.scraped_at,
       updated_at   = NOW()
     RETURNING *`,
    [
      input.sportId,
      input.name,
      input.shortName ?? null,
      input.slug,
      input.gender ?? null,
      input.category ?? null,
      input.country,
      input.organizer ?? 'RFEP',
      input.scope ?? 'national',
      input.region ?? null,
      input.ageCategory ?? 'senior',
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

/**
 * Lista competiciones.
 * Por defecto excluye las archivadas (archived_at IS NOT NULL).
 * Pasar { includeArchived: true } para el panel de admin o historial.
 */
export async function listCompetitions(
  sportId?: string,
  options: { includeArchived?: boolean } = {}
): Promise<DbCompetition[]> {
  const { includeArchived = false } = options;
  const archiveClause = includeArchived ? '' : 'AND archived_at IS NULL';

  if (sportId) {
    const result = await db.query<DbCompetition>(
      `SELECT * FROM competitions WHERE sport_id = $1 ${archiveClause} ORDER BY name`,
      [sportId]
    );
    return result.rows;
  }
  const result = await db.query<DbCompetition>(
    `SELECT * FROM competitions WHERE TRUE ${archiveClause} ORDER BY name`
  );
  return result.rows;
}

// ── Archivado manual ──────────────────────────────────────────────────────────

/** Archiva una competicion. La oculta de listados pero no borra datos. */
export async function archiveCompetition(
  id: string,
  client: pg.PoolClient | typeof db = db
): Promise<DbCompetition | null> {
  const result = await client.query<DbCompetition>(
    `UPDATE competitions SET archived_at = NOW(), updated_at = NOW()
      WHERE id = $1 RETURNING *`,
    [id]
  );
  return result.rows[0] ?? null;
}

/** Reactiva manualmente una competicion archivada. */
export async function restoreCompetition(
  id: string,
  client: pg.PoolClient | typeof db = db
): Promise<DbCompetition | null> {
  const result = await client.query<DbCompetition>(
    `UPDATE competitions SET archived_at = NULL, updated_at = NOW()
      WHERE id = $1 RETURNING *`,
    [id]
  );
  return result.rows[0] ?? null;
}

/** Lista competiciones archivadas con fecha de ultima actividad conocida. */
export async function listArchivedCompetitions(): Promise<Array<DbCompetition & { last_active: Date | null }>> {
  const result = await db.query<DbCompetition & { last_active: Date | null }>(
    `SELECT c.*,
            MAX(COALESCE(s.end_date, s.start_date))::timestamptz AS last_active
       FROM competitions c
       LEFT JOIN seasons s ON s.competition_id = c.id
      WHERE c.archived_at IS NOT NULL
      GROUP BY c.id
      ORDER BY c.name`
  );
  return result.rows;
}

// ── Duplicados potenciales ────────────────────────────────────────────────────

export interface DuplicateCandidate {
  id_a: string;
  name_a: string;
  slug_a: string;
  id_b: string;
  name_b: string;
  slug_b: string;
  sim: number;
  sport_id: string;
}

/**
 * Devuelve pares de competiciones activas con similitud de nombre >= threshold.
 * Usa la vista v_competition_duplicates (migracion 022).
 */
export async function findDuplicateCandidates(
  threshold = 0.6
): Promise<DuplicateCandidate[]> {
  const result = await db.query<DuplicateCandidate>(
    `SELECT * FROM v_competition_duplicates WHERE sim >= $1 ORDER BY sim DESC`,
    [threshold]
  );
  return result.rows;
}

// ── Fusion de duplicados ──────────────────────────────────────────────────────

export interface MergeCompetitionsResult {
  seasonsMoved: number;
  canonicalId: string;
  removedId: string;
  canonicalName: string;
}

/**
 * Fusiona mergeId en keepId:
 *   1. Mueve todas las temporadas del duplicado a la canonica.
 *   2. Elimina la competicion duplicada.
 *
 * Destructiva: usar solo desde admin con confirmacion explicita.
 */
export async function mergeCompetitions(
  keepId: string,
  mergeId: string
): Promise<MergeCompetitionsResult> {
  const client = await (db as unknown as { connect: () => Promise<pg.PoolClient> }).connect();
  try {
    await client.query('BEGIN');

    const both = await client.query<{ id: string; name: string }>(
      `SELECT id, name FROM competitions WHERE id = ANY($1::uuid[])`,
      [[keepId, mergeId]]
    );
    if (both.rows.length !== 2) {
      throw new Error(
        `Una o ambas competiciones no existen (keepId=${keepId}, mergeId=${mergeId})`
      );
    }
    const canonical = both.rows.find((r) => r.id === keepId)!;

    const seasonsRes = await client.query<{ id: string; slug: string }>(
      `SELECT id, slug FROM seasons WHERE competition_id = $1`,
      [mergeId]
    );

    let seasonsMoved = 0;
    for (const season of seasonsRes.rows) {
      let newSlug = season.slug;
      for (let n = 2; ; n++) {
        const clash = await client.query(
          `SELECT 1 FROM seasons WHERE competition_id = $1 AND slug = $2`,
          [keepId, newSlug]
        );
        if ((clash.rowCount ?? 0) === 0) break;
        newSlug = `${season.slug}-${n}`;
      }
      await client.query(
        `UPDATE seasons SET competition_id = $1, slug = $2, updated_at = NOW() WHERE id = $3`,
        [keepId, newSlug, season.id]
      );
      seasonsMoved++;
    }

    await client.query(`DELETE FROM competitions WHERE id = $1`, [mergeId]);
    await client.query('COMMIT');

    return { seasonsMoved, canonicalId: keepId, removedId: mergeId, canonicalName: canonical.name };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    (client as pg.PoolClient).release();
  }
}

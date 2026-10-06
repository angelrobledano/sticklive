import pg from 'pg';
import { db } from '../client.js';
import type { DataQuality } from './competitions.js';

export interface DbSeason {
  id: string;
  competition_id: string;
  name: string;
  slug: string;
  start_date: Date | null;
  end_date: Date | null;
  is_current: boolean;
  source_id: string | null;
  source_ref: string | null;
  source_url: string | null;
  scraped_at: Date | null;
  data_quality: string;
  created_at: Date;
  updated_at: Date;
}

export interface UpsertSeasonInput {
  competitionId: string;
  name: string;
  slug: string;
  startDate?: Date;
  endDate?: Date;
  isCurrent?: boolean;
  sourceId?: string;
  sourceRef?: string;
  sourceUrl?: string;
  scrapedAt?: Date;
}

export async function upsertSeason(
  input: UpsertSeasonInput,
  client: pg.PoolClient | typeof db = db
): Promise<DbSeason> {
  const result = await client.query<DbSeason>(
    `INSERT INTO seasons
       (competition_id, name, slug, start_date, end_date, is_current,
        source_id, source_ref, source_url, scraped_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (competition_id, slug) DO UPDATE SET
       name       = EXCLUDED.name,
       start_date = COALESCE(EXCLUDED.start_date, seasons.start_date),
       end_date   = COALESCE(EXCLUDED.end_date,   seasons.end_date),
       is_current = EXCLUDED.is_current,
       source_ref = COALESCE(EXCLUDED.source_ref, seasons.source_ref),
       scraped_at = EXCLUDED.scraped_at,
       updated_at = NOW()
     RETURNING *`,
    [
      input.competitionId,
      input.name,
      input.slug,
      input.startDate ?? null,
      input.endDate ?? null,
      input.isCurrent ?? false,
      input.sourceId ?? null,
      input.sourceRef ?? null,
      input.sourceUrl ?? null,
      input.scrapedAt ?? null,
    ]
  );
  // El trigger trg_reactivate_competition en DB reactiva automaticamente
  // la competicion padre si estaba archivada.
  return result.rows[0]!;
}

export async function findCurrentSeason(competitionId: string): Promise<DbSeason | null> {
  const result = await db.query<DbSeason>(
    'SELECT * FROM seasons WHERE competition_id = $1 AND is_current = TRUE LIMIT 1',
    [competitionId]
  );
  return result.rows[0] ?? null;
}

export async function findSeasonBySourceRef(sourceRef: string): Promise<DbSeason | null> {
  const result = await db.query<DbSeason>(
    'SELECT * FROM seasons WHERE source_ref = $1',
    [sourceRef]
  );
  return result.rows[0] ?? null;
}

// ── Calidad de datos / visibilidad (migración 067) ───────────────────────────

export interface SeasonQualityRow {
  id: string;
  name: string;
  slug: string;
  is_current: boolean;
  data_quality: string;
  match_count: string;
}

/** Lista TODAS las temporadas de una competición (incl. ocultas). */
export async function listSeasonsForQuality(competitionId: string): Promise<SeasonQualityRow[]> {
  const result = await db.query<SeasonQualityRow>(`
    SELECT s.id, s.name, s.slug, s.is_current, s.data_quality,
           COUNT(m.id)::text AS match_count
      FROM seasons s
      LEFT JOIN matches m ON m.season_id = s.id
     WHERE s.competition_id = $1
     GROUP BY s.id
     ORDER BY s.is_current DESC, s.start_date DESC NULLS LAST, s.name DESC
  `, [competitionId]);
  return result.rows;
}

/** Marca la fiabilidad de una temporada. Devuelve null si no existe. */
export async function setSeasonQuality(
  id: string,
  quality: DataQuality
): Promise<DbSeason | null> {
  const result = await db.query<DbSeason>(
    `UPDATE seasons SET data_quality = $2, updated_at = NOW()
      WHERE id = $1 RETURNING *`,
    [id, quality]
  );
  return result.rows[0] ?? null;
}

import { db } from '../client.js';
import type { ScrapeStatus } from '@sports/shared-types';

export interface DbScrapeLog {
  id: string;
  source_id: string | null;
  scraper_key: string;
  entity_type: string;
  entity_ref: string | null;
  status: ScrapeStatus;
  records_found: number | null;
  records_upserted: number | null;
  error_message: string | null;
  duration_ms: number | null;
  scraped_at: Date;
}

export interface InsertScrapeLogInput {
  sourceId?: string;
  scraperKey: string;
  entityType: string;
  entityRef?: string;
  status: ScrapeStatus;
  recordsFound?: number;
  recordsUpserted?: number;
  errorMessage?: string;
  durationMs?: number;
}

export async function insertScrapeLog(input: InsertScrapeLogInput): Promise<DbScrapeLog> {
  const result = await db.query<DbScrapeLog>(
    `INSERT INTO scrape_logs
       (source_id, scraper_key, entity_type, entity_ref, status,
        records_found, records_upserted, error_message, duration_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [
      input.sourceId ?? null,
      input.scraperKey,
      input.entityType,
      input.entityRef ?? null,
      input.status,
      input.recordsFound ?? null,
      input.recordsUpserted ?? null,
      input.errorMessage ?? null,
      input.durationMs ?? null,
    ]
  );
  return result.rows[0]!;
}

export async function getLastScrapeLog(
  scraperKey: string,
  entityType: string
): Promise<DbScrapeLog | null> {
  const result = await db.query<DbScrapeLog>(
    `SELECT * FROM scrape_logs
     WHERE scraper_key = $1 AND entity_type = $2
     ORDER BY scraped_at DESC
     LIMIT 1`,
    [scraperKey, entityType]
  );
  return result.rows[0] ?? null;
}

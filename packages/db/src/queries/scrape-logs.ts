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

/**
 * Rastro de runs largos (#331): jobs como el barrido de fichas, purge o
 * partition-guard no pasan por los loaders, así que no dejaban NADA en
 * scrape_logs — ni siquiera que EMPEZARON (los gaps del 13/09 no dejaron runs
 * "zombie" rastreables). Patrón: fila `running` al INICIO y UPDATE al final.
 * Si el proceso muere a mitad, la fila queda en `running`: eso ES la señal de
 * run abortado que antes era invisible.
 */
export async function startScrapeRun(input: {
  sourceId?: string;
  scraperKey: string;
  entityType: string;
  entityRef?: string;
}): Promise<string> {
  const result = await db.query<{ id: string }>(
    `INSERT INTO scrape_logs
       (source_id, scraper_key, entity_type, entity_ref, status, records_found, records_upserted)
     VALUES ($1,$2,$3,$4,'running',0,0)
     RETURNING id`,
    [
      input.sourceId ?? null,
      input.scraperKey,
      input.entityType,
      input.entityRef ?? null,
    ]
  );
  return result.rows[0]!.id;
}

export async function finishScrapeRun(
  id: string,
  outcome: {
    status: ScrapeStatus;
    recordsFound?: number;
    recordsUpserted?: number;
    errorMessage?: string;
    durationMs?: number;
  }
): Promise<void> {
  await db.query(
    `UPDATE scrape_logs SET
       status = $2, records_found = $3, records_upserted = $4,
       error_message = $5, duration_ms = $6, scraped_at = NOW()
     WHERE id = $1`,
    [
      id,
      outcome.status,
      outcome.recordsFound ?? null,
      outcome.recordsUpserted ?? null,
      outcome.errorMessage ?? null,
      outcome.durationMs ?? null,
    ]
  );
}

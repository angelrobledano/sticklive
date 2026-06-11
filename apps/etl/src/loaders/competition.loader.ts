import {
  upsertCompetition,
  withTransaction,
  findSportBySlug,
  insertScrapeLog,
} from '@sports/db';
import type { ScrapedCompetition, ScrapeResult } from '@sports/shared-types';
import { createLogger } from '@sports/logger';
import { transformCompetition } from '../transformers/competition.transformer.js';

const log = createLogger({ module: 'loader:competition' });

export interface LoadCompetitionsResult {
  upserted: number;
  skipped: number;
  errors: Array<{ item: string; error: string }>;
}

export async function loadCompetitions(
  scrapeResult: ScrapeResult<ScrapedCompetition>,
  sportSlug = 'hockey-patines'
): Promise<LoadCompetitionsResult> {
  const start = Date.now();
  const errors: Array<{ item: string; error: string }> = [];
  let upserted = 0;
  let skipped = 0;

  // Obtener sport_id
  const sport = await findSportBySlug(sportSlug);
  if (!sport) {
    throw new Error(`Deporte no encontrado: "${sportSlug}". ¿Se ha ejecutado la migración con seed?`);
  }

  log.info({ total: scrapeResult.data.length, sport: sportSlug }, 'Cargando competiciones');

  for (const raw of scrapeResult.data) {
    try {
      const { input, warnings } = transformCompetition(raw, sport.id);

      if (warnings.length > 0) {
        log.warn({ item: raw.rawName, warnings }, 'Warnings en transformación');
      }

      await withTransaction(async (client) => {
        await upsertCompetition(input, client);
      });

      upserted++;
      log.debug({ name: input.name, slug: input.slug }, 'Competición upserted');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error({ item: raw.rawName, err }, 'Error al cargar competición');
      errors.push({ item: raw.rawName, error: message });
      skipped++;
    }
  }

  const durationMs = Date.now() - start;

  // Registrar en scrape_logs
  await insertScrapeLog({
    scraperKey: scrapeResult.scraperKey,
    entityType: 'competition',
    status: errors.length === 0 ? 'success' : skipped === scrapeResult.data.length ? 'error' : 'partial',
    recordsFound: scrapeResult.data.length,
    recordsUpserted: upserted,
    errorMessage: errors.length > 0 ? errors.map((e) => e.error).join(' | ') : undefined,
    durationMs,
  });

  log.info({ upserted, skipped, errors: errors.length, durationMs }, 'Carga de competiciones completada');

  return { upserted, skipped, errors };
}

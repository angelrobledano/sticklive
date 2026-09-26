// Sentry PRIMERO: instrumenta interceptando la carga de módulos (ver instrument.ts).
import './instrument.js';
import * as Sentry from '@sentry/node';
import { pathToFileURL } from 'node:url';
import { createLogger } from '@sports/logger';
import { db, closeDb } from '@sports/db';
import { evaluateScrapeHealth, alertMessage, type ScrapeSummary } from './scrape-health.js';

/**
 * Vigilante de salud del scraping (auditoría I3).
 *
 * Corre una vez al día desde el scheduler. Lee el ÚLTIMO run por
 * (scraper_key, entity_type) de scrape_logs y avisa a Sentry (warning) si:
 *   - un scraper no ha corrido en más de SCRAPE_STALE_HOURS (parado), o
 *   - su último run terminó OK con 0 resultados (éxito silencioso: la fuente
 *     probablemente cambió el HTML/API), o
 *   - un scraper de SCRAPE_EXPECTED_KEYS no tiene ninguna ejecución.
 *
 * La lógica de decisión vive en scrape-health.ts (pura y testeada); aquí solo
 * está la E/S.
 *
 * Uso:  node dist/apps/etl/src/scrape-health-watch.js
 * Env:
 *   SCRAPE_STALE_HOURS    umbral de "parado" en horas (defecto 26)
 *   SCRAPE_EXPECTED_KEYS  scraper_key esperados, separados por comas (opcional)
 */

const log = createLogger({ service: 'scrape-health-watch' });
const STALE_HOURS = Number(process.env['SCRAPE_STALE_HOURS'] ?? 26);
const EXPECTED_KEYS = (process.env['SCRAPE_EXPECTED_KEYS'] ?? '')
  .split(',').map((s) => s.trim()).filter(Boolean);

/** Último run por (scraper_key, entity_type). */
export async function loadSummaries(): Promise<ScrapeSummary[]> {
  const { rows } = await db.query<{
    scraper_key: string; entity_type: string; scraped_at: Date;
    status: ScrapeSummary['lastStatus']; records_found: number | null;
  }>(
    `SELECT DISTINCT ON (scraper_key, entity_type)
        scraper_key, entity_type, scraped_at, status, records_found
       FROM scrape_logs
      ORDER BY scraper_key, entity_type, scraped_at DESC`,
  );
  return rows.map((r) => ({
    scraperKey: r.scraper_key,
    entityType: r.entity_type,
    lastScrapedAt: r.scraped_at,
    lastStatus: r.status,
    lastRecordsFound: r.records_found,
  }));
}

async function main(): Promise<void> {
  const summaries = await loadSummaries();
  const alerts = evaluateScrapeHealth(new Date(), summaries, {
    staleHours: STALE_HOURS,
    expectedKeys: EXPECTED_KEYS.length ? EXPECTED_KEYS : undefined,
  });

  if (alerts.length === 0) {
    log.info({ scrapers: summaries.length }, 'Salud del scraping OK');
    return;
  }
  for (const a of alerts) {
    const msg = alertMessage(a);
    log.warn({ alert: a }, msg);
    Sentry.captureMessage(msg, { level: 'warning', extra: { ...a } });
  }
  log.warn({ count: alerts.length }, 'Alertas de salud del scraping enviadas a Sentry');
}

// Sólo se ejecuta al lanzarlo directamente (scheduler), no al importarlo (tests).
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main()
    .catch((err) => {
      log.error({ err }, 'scrape-health-watch falló');
      Sentry.captureException(err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await Sentry.flush(2000);
      await closeDb();
    });
}

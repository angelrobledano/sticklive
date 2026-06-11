/**
 * Punto de entrada del ETL.
 *
 * El ETL puede ejecutarse de dos formas:
 *
 * 1. En proceso con el scraper (import directo):
 *      import { EtlPipeline } from '@sports/etl';
 *      const pipeline = new EtlPipeline({ sportSlug: 'hockey-patines' });
 *      await pipeline.runCompetitions(scrapeResult);
 *
 * 2. Como proceso independiente recibiendo JSON por stdin o fichero:
 *      node dist/index.js --entity=competition --file=./scrape-output.json
 *
 * El modo 2 es útil para re-procesar datos históricos sin volver a scrapear.
 */
import { readFileSync } from 'fs';
import { createLogger } from '@sports/logger';
import { closeDb } from '@sports/db';
import { analytics, shutdownAnalytics } from '@sports/analytics';
import { EtlPipeline } from './pipeline.js';

const log = createLogger({ service: 'etl' });

async function main() {
  const args = parseArgs(process.argv.slice(2));

  log.info({ args }, 'ETL iniciado');

  const isDryRun = process.env['ETL_DRY_RUN'] === 'true' || args['dry-run'] === 'true';
  const sportSlug = args['sport'] ?? 'hockey-patines';
  const seasonId = args['season-id'];
  const entity = args['entity'];
  const filePath = args['file'];

  if (!entity) {
    log.error('Uso: node dist/index.js --entity=<competition|match|standing> --file=<path.json> [--dry-run]');
    process.exit(1);
  }

  if (!filePath) {
    log.error('--file requerido en modo CLI');
    process.exit(1);
  }

  let scrapeResult: unknown;
  try {
    const raw = readFileSync(filePath, 'utf-8');
    scrapeResult = JSON.parse(raw);
  } catch (err) {
    log.error({ err, filePath }, 'Error al leer fichero de scraping');
    process.exit(1);
  }

  const pipeline = new EtlPipeline({ sportSlug, seasonId, dryRun: isDryRun });

  let result;
  switch (entity) {
    case 'competition':
      result = await pipeline.runCompetitions(scrapeResult as never);
      break;
    case 'match':
      result = await pipeline.runMatches(scrapeResult as never);
      break;
    case 'standing':
      result = await pipeline.runStandings(scrapeResult as never);
      break;
    default:
      log.error({ entity }, 'Entidad desconocida. Opciones: competition, match, standing');
      process.exit(1);
  }

  log.info({ result }, 'ETL completado');

  analytics.capture({
    distinctId: 'etl-pipeline',
    event: 'etl_pipeline_completed',
    properties: {
      entity,
      sport: sportSlug,
      dry_run: isDryRun,
      processed: result.processedCount,
      errors: result.errorCount,
      success: result.errorCount === 0,
    },
  });

  if (result.errorCount > 0) {
    log.warn({ errorCount: result.errorCount }, 'ETL completado con errores parciales');
  }
}

function parseArgs(args: string[]): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const arg of args) {
    const [key, value] = arg.replace(/^--/, '').split('=');
    if (key) parsed[key] = value ?? 'true';
  }
  return parsed;
}

main()
  .catch((err) => {
    log.error({ err }, 'Error fatal en ETL');
    process.exit(1);
  })
  .finally(async () => {
    await Promise.all([closeDb(), shutdownAnalytics()]);
  });

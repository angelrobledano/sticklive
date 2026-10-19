/**
 * C7 — Clasificación final de las temporadas cerradas.
 *
 * El refresco horario de la clasificación solo recorre las competiciones
 * activas de `competition_sources`, que guarda UN idc por competición: al
 * pasar a la temporada nueva, la anterior deja de refrescarse. OK Liga Plata
 * Sur 2025/26 se quedó en la jornada 20 de 22 (Simar Igualada con 46 puntos en
 * vez de 52) aunque la fuente publica la tabla final.
 *
 * Este job busca temporadas sin partidos pendientes cuya tabla tiene equipos
 * con menos PJ que partidos de liga terminados, la vuelve a pedir a la fuente
 * con el idc de la propia temporada (`seasons.source_ref`) y avisa a Sentry si,
 * aun así, no cuadra. La tabla sigue saliendo de la fuente, nunca se recalcula
 * aquí: lleva sanciones de puntos (Barça Atlètic, -1) que los resultados no
 * dicen.
 *
 * Uso (producción; el scheduler lo lanza a diario):
 *   $DC exec etl node dist/apps/etl/src/standings-final.js --dry-run
 *   $DC exec etl node dist/apps/etl/src/standings-final.js
 */
import './instrument.js'; // Sentry.init — el PRIMERO de todo
import * as Sentry from '@sentry/node';
import { pathToFileURL } from 'node:url';
import { closeDb } from '@sports/db';
import { createLogger } from '@sports/logger';
import { EtlPipeline } from './pipeline.js';
import { acquireEtlLock } from './etl-lock.js';
import { FepStandingsScraper } from '../../scraper/src/scrapers/fep/fep-standings.scraper.js';
import { findStaleFinalStandings, type StaleFinalStandings } from './standings-reconcile.js';

const log = createLogger({ service: 'standings-final' });
const SPORT_SLUG = 'hockey-patines';
const PAUSE_MS = 2_000;

async function refresh(item: StaleFinalStandings): Promise<'ok' | 'empty' | 'partial' | 'error'> {
  const result = await new FepStandingsScraper({ idc: item.idc, competitionName: item.competitionName }).run();
  if (!result.success) return 'error';
  if (result.data.length === 0) return 'empty';
  const loaded = await new EtlPipeline({ sportSlug: SPORT_SLUG, seasonId: item.seasonId, dryRun: false }).runStandings(result);
  return loaded.errorCount === 0 ? 'ok' : 'partial';
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const candidates = await findStaleFinalStandings();
  log.info({ total: candidates.length, dryRun, candidates }, 'Temporadas cerradas con la clasificación atrasada');
  if (dryRun || candidates.length === 0) return;

  const lock = await acquireEtlLock();
  if (!lock) {
    log.warn('Otro proceso de ingesta tiene el lock global — salgo sin ejecutar');
    return;
  }
  try {
    for (const item of candidates) {
      try {
        const outcome = await refresh(item);
        log.info({ ...item, outcome }, 'Clasificación final refrescada');
      } catch (err) {
        log.warn({ err, ...item }, 'No se pudo refrescar la clasificación final');
      }
      await new Promise((r) => setTimeout(r, PAUSE_MS));
    }
  } finally {
    await lock.release();
  }

  // Lo que la fuente tampoco arregla queda a la vista: no se publica una tabla
  // final que no cuadra con los resultados sin que nadie lo sepa.
  const ids = new Set(candidates.map((c) => c.seasonId));
  const still = (await findStaleFinalStandings(500)).filter((c) => ids.has(c.seasonId));
  if (still.length > 0) {
    log.error({ still }, 'Clasificaciones finales que siguen sin cuadrar con los resultados');
    Sentry.captureMessage(
      `standings-final: ${still.length} clasificación(es) final(es) no cuadran con los resultados`,
      { level: 'warning', extra: { still } }
    );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main()
    .catch((err) => { log.error({ err }, 'standings-final falló'); Sentry.captureException(err); process.exitCode = 1; })
    .finally(async () => { await Sentry.flush(2000); await closeDb(); });
}

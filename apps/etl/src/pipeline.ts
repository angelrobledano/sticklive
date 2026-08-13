/**
 * Pipeline ETL — orquestador principal.
 *
 * Conecta la salida del scraper con los loaders.
 * Un pipeline por tipo de entidad. El orden de ejecución importa:
 *
 *   1. Competiciones (no dependen de nada)
 *   2. Temporadas (dependen de competiciones)
 *   3. Equipos (no dependen de temporadas, pero deben estar antes de partidos)
 *   4. Jornadas/Rounds (dependen de temporadas)
 *   5. Partidos (dependen de temporadas, jornadas, equipos)
 *   6. Clasificaciones (dependen de temporadas, equipos)
 *
 * Si ejecutas los scrapers de forma asíncrona, asegúrate de que el ETL
 * respeta este orden antes de cargar partidos o clasificaciones.
 */
import type { ScrapeResult, ScrapedCompetition, ScrapedMatch, ScrapedStanding } from '@sports/shared-types';
import { createLogger } from '@sports/logger';
import { findSportBySlug } from '@sports/db';
import { loadCompetitions } from './loaders/competition.loader.js';
import { loadMatches } from './loaders/match.loader.js';
import { loadStandings } from './loaders/standing.loader.js';

const log = createLogger({ module: 'pipeline' });

export interface PipelineContext {
  sportSlug: string;
  seasonId?: string;   // Requerido para partidos y clasificaciones
  dryRun?: boolean;    // Si true, transforma pero no persiste
  /** Si true, el loader de partidos crea/asigna rondas desde roundRef/roundNumber
   *  (solo para fuentes que emiten estructura de fases, p. ej. World Skate).
   *  El flujo FEP lo deja en false → comportamiento sin cambios. */
  createRounds?: boolean;
  /** Lote de importación (A4). Se propaga al loader de partidos para etiquetar
   *  las filas nuevas del re-scrape; NULL/undefined = sin lote (directo, live). */
  importBatchId?: string;
  /** Enrich (A5). Se propaga al loader; activa el upsert que reasigna temporada
   *  y etiqueta en el ON CONFLICT (recuperación de fechas del histórico). */
  enrich?: boolean;
}

export interface PipelineResult {
  entityType: string;
  upserted: number;
  skipped: number;
  errorCount: number;
  durationMs: number;
}

export class EtlPipeline {
  private ctx: PipelineContext;

  constructor(ctx: PipelineContext) {
    this.ctx = ctx;
  }

  async runCompetitions(
    scrapeResult: ScrapeResult<ScrapedCompetition>
  ): Promise<PipelineResult> {
    const start = Date.now();

    if (this.ctx.dryRun) {
      log.info('DRY RUN — competiciones no persistidas');
      return { entityType: 'competition', upserted: 0, skipped: 0, errorCount: 0, durationMs: 0 };
    }

    log.info({ scraperKey: scrapeResult.scraperKey }, 'Pipeline: competiciones');
    const result = await loadCompetitions(scrapeResult, this.ctx.sportSlug);

    return {
      entityType: 'competition',
      upserted: result.upserted,
      skipped: result.skipped,
      errorCount: result.errors.length,
      durationMs: Date.now() - start,
    };
  }

  async runMatches(
    scrapeResult: ScrapeResult<ScrapedMatch>
  ): Promise<PipelineResult> {
    const start = Date.now();

    if (!this.ctx.seasonId) {
      throw new Error('seasonId requerido para cargar partidos');
    }

    if (this.ctx.dryRun) {
      log.info('DRY RUN — partidos no persistidos');
      return { entityType: 'match', upserted: 0, skipped: 0, errorCount: 0, durationMs: 0 };
    }

    const sport = await findSportBySlug(this.ctx.sportSlug);
    if (!sport) throw new Error(`Deporte no encontrado: ${this.ctx.sportSlug}`);

    log.info({ scraperKey: scrapeResult.scraperKey }, 'Pipeline: partidos');
    const result = await loadMatches(scrapeResult, sport.id, {
      createRounds: this.ctx.createRounds ?? false,
      importBatchId: this.ctx.importBatchId,
      enrich: this.ctx.enrich,
    });

    return {
      entityType: 'match',
      upserted: result.upserted,
      skipped: result.skipped,
      errorCount: result.errors.length,
      durationMs: Date.now() - start,
    };
  }

  async runStandings(
    scrapeResult: ScrapeResult<ScrapedStanding>
  ): Promise<PipelineResult> {
    const start = Date.now();

    if (!this.ctx.seasonId) {
      throw new Error('seasonId requerido para cargar clasificaciones');
    }

    if (this.ctx.dryRun) {
      log.info('DRY RUN — clasificaciones no persistidas');
      return { entityType: 'standing', upserted: 0, skipped: 0, errorCount: 0, durationMs: 0 };
    }

    const sport = await findSportBySlug(this.ctx.sportSlug);
    if (!sport) throw new Error(`Deporte no encontrado: ${this.ctx.sportSlug}`);

    log.info({ scraperKey: scrapeResult.scraperKey }, 'Pipeline: clasificaciones');
    const result = await loadStandings(scrapeResult, sport.id, this.ctx.seasonId);

    return {
      entityType: 'standing',
      upserted: result.upserted,
      skipped: result.skipped,
      errorCount: result.errors.length,
      durationMs: Date.now() - start,
    };
  }
}

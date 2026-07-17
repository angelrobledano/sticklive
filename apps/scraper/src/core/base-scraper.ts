/**
 * Clase base que deben extender todos los scrapers.
 * Provee: logging contextual, manejo de errores, métricas de ejecución,
 * y el contrato de interfaz que consume el runner de crons.
 */
import { ScrapeResult, ScrapeError } from '@sports/shared-types';
import { createLogger, Logger } from '@sports/logger';

export interface ScraperConfig {
  /** Clave única del scraper — coincide con data_sources.scraper_key */
  scraperKey: string;
  /** Tipo de entidad que produce */
  entityType: string;
  /** ID UUID de la fuente en DB */
  sourceId: string;
}

export abstract class BaseScraper<T> {
  protected readonly log: Logger;
  protected readonly config: ScraperConfig;

  constructor(config: ScraperConfig) {
    this.config = config;
    this.log = createLogger({
      scraper: config.scraperKey,
      entity: config.entityType,
    });
  }

  /**
   * Método principal que implementa cada scraper.
   * Debe devolver datos crudos sin normalizar (eso es tarea del ETL).
   */
  protected abstract scrape(): Promise<T[]>;

  /**
   * Ejecuta el scraper con manejo de errores y métricas.
   */
  async run(): Promise<ScrapeResult<T>> {
    const start = Date.now();
    const errors: ScrapeError[] = [];
    let data: T[] = [];

    this.log.info(`Iniciando scraper [${this.config.scraperKey}/${this.config.entityType}]`);

    try {
      data = await this.scrape();
      this.log.info({ recordsFound: data.length }, 'Scraping completado');
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.log.error({ err }, 'Error fatal en scraper');
      errors.push({
        message: error.message,
        stack: error.stack,
      });
    }

    const durationMs = Date.now() - start;

    return {
      success: errors.length === 0,
      data,
      errors,
      durationMs,
      scraperKey: this.config.scraperKey,
      entityType: this.config.entityType,
    };
  }

  /**
   * Captura un error no fatal (por ejemplo, fallo al parsear un item concreto)
   * y lo registra sin abortar el scraping completo.
   */
  protected captureError(errors: ScrapeError[], err: unknown, context?: Partial<ScrapeError>): void {
    const error = err instanceof Error ? err : new Error(String(err));
    const scrapeError: ScrapeError = {
      message: error.message,
      stack: error.stack,
      ...context,
    };
    this.log.warn(scrapeError, 'Error no fatal en scraper');
    errors.push(scrapeError);
  }
}

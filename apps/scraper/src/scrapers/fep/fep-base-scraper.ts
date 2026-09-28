/**
 * Base común de los scrapers FEP (#330).
 *
 * El `run()` de `BaseScraper` solo propaga los errores FATALES: los fallos de
 * parseo por item se acumulan con `captureError` pero nunca llegaban al
 * `ScrapeResult`. Además, el array donde se acumulaban se descartaba (cada
 * scraper lo exponía con un getter que devolvía un `[]` nuevo), así que
 * `success` seguía en `true` aunque fallara TODOS los parseos: un fallo de
 * fuente silencioso.
 *
 * Esta base acumula los errores en `parseErrors`, los expone en
 * `result.errors` y degrada `success` a `false` cuando el ratio de fallos es
 * significativo (ver `isParseFailureSignificant`). Los scrapers FEP extienden
 * esta clase en lugar de `BaseScraper` y llaman a
 * `this.captureError(this.parseErrors, err, …)`.
 */
import { BaseScraper } from '../../core/base-scraper.js';
import type { ScrapeResult, ScrapeError } from '@sports/shared-types';

/**
 * Proporción de fallos de parseo a partir de la cual la ejecución se considera
 * fallida. 0.5 = falla la mitad o más de lo intentado: señal de un cambio
 * estructural en la fuente (p. ej. una clase CSS), no de filas sueltas raras.
 * No editar a la ligera: `success=false` corta el ETL de ese scrape (ver
 * `apps/scraper/src/index.ts`).
 */
export const PARSE_FAILURE_RATIO = 0.5;

/**
 * ¿Es significativo el número de fallos de parseo? Un par de filas raras no
 * deben tumbar el scrape; que falle la mitad (o que no se parsee nada) sí.
 */
export function isParseFailureSignificant(parsed: number, failed: number): boolean {
  if (failed <= 0) return false;
  // Sin ningún item parseado y con fallos: la fuente entera cayó.
  if (parsed <= 0) return true;
  return failed / (parsed + failed) >= PARSE_FAILURE_RATIO;
}

/**
 * Incorpora los errores de parseo acumulados al resultado: siempre se exponen
 * en `result.errors`; `success` solo se degrada si el ratio de fallos es
 * significativo.
 */
export function applyParseErrors<T>(result: ScrapeResult<T>, parseErrors: ScrapeError[]): void {
  if (parseErrors.length === 0) return;
  result.errors.push(...parseErrors);
  if (isParseFailureSignificant(result.data.length, parseErrors.length)) {
    result.success = false;
  }
}

export abstract class FepBaseScraper<T> extends BaseScraper<T> {
  /** Errores de parseo no fatales acumulados durante `scrape()`. */
  protected parseErrors: ScrapeError[] = [];

  override async run(): Promise<ScrapeResult<T>> {
    try {
      const result = await super.run();
      applyParseErrors(result, this.parseErrors);
      return result;
    } finally {
      // Limpiar para que una reejecución del mismo scraper no arrastre errores.
      this.parseErrors.length = 0;
    }
  }
}

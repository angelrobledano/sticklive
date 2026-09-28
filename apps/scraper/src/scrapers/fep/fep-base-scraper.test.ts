import { describe, it, expect } from 'vitest';
import {
  FepBaseScraper,
  isParseFailureSignificant,
  applyParseErrors,
  PARSE_FAILURE_RATIO,
} from './fep-base-scraper.js';
import type { ScrapeResult } from '@sports/shared-types';

function emptyResult(data: string[]): ScrapeResult<string> {
  return {
    success: true,
    data,
    errors: [],
    durationMs: 0,
    scraperKey: 'test',
    entityType: 'test',
  };
}

/**
 * #330 — los scrapers FEP descartaban el array donde captureError acumula los
 * fallos de parseo y mantenían success=true aunque fallara todo. Estos tests
 * fijan la acumulación, la exposición en result.errors y la degradación de
 * success cuando el ratio de fallos es significativo.
 */
describe('isParseFailureSignificant', () => {
  it('sin fallos nunca es significativo', () => {
    expect(isParseFailureSignificant(10, 0)).toBe(false);
    expect(isParseFailureSignificant(0, 0)).toBe(false);
  });

  it('con algún fallo pero ratio bajo no es significativo', () => {
    expect(isParseFailureSignificant(9, 1)).toBe(false);
    expect(isParseFailureSignificant(3, 1)).toBe(false);
  });

  it('a partir del ratio umbral es significativo', () => {
    expect(isParseFailureSignificant(1, 1)).toBe(true); // 50%
    expect(isParseFailureSignificant(1, 3)).toBe(true);
  });

  it('si no se parseó nada y hubo fallos, siempre es significativo', () => {
    expect(isParseFailureSignificant(0, 1)).toBe(true);
    expect(isParseFailureSignificant(0, 5)).toBe(true);
  });
});

describe('applyParseErrors', () => {
  it('expone los errores acumulados en result.errors', () => {
    const result = emptyResult(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']);
    applyParseErrors(result, [{ message: 'fallo X', entityRef: 'idp_1' }]);
    expect(result.errors).toEqual([{ message: 'fallo X', entityRef: 'idp_1' }]);
  });

  it('mantiene success=true si los fallos no son significativos', () => {
    const result = emptyResult(Array.from({ length: 9 }, (_, i) => `m${i}`));
    applyParseErrors(result, [{ message: 'fallo puntual' }]);
    expect(result.success).toBe(true);
  });

  it('degrada success=false cuando falla la mitad o más', () => {
    const result = emptyResult(['m0']);
    applyParseErrors(result, [{ message: 'fallo 1' }, { message: 'fallo 2' }, { message: 'fallo 3' }]);
    expect(result.success).toBe(false);
  });

  it('degrada success=false si no se parseó nada y hubo fallos', () => {
    const result = emptyResult([]);
    applyParseErrors(result, [{ message: 'fallo total' }]);
    expect(result.success).toBe(false);
  });
});

/** Scraper de prueba: simula fallos de parseo por item. */
class FakeScraper extends FepBaseScraper<string> {
  constructor(
    private readonly parsed: string[],
    private readonly failures: number,
  ) {
    super({ scraperKey: 'test', entityType: 'test', sourceId: 'test-source' });
  }

  protected async scrape(): Promise<string[]> {
    for (let i = 0; i < this.failures; i++) {
      this.captureError(this.parseErrors, new Error(`fallo ${i}`), { entityRef: `item_${i}` });
    }
    return this.parsed;
  }
}

describe('FepBaseScraper.run', () => {
  it('acumula los errores de parseo y los propaga en result.errors', async () => {
    const result = await new FakeScraper(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'], 1).run();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toBe('fallo 0');
    expect(result.errors[0]!.entityRef).toBe('item_0');
    expect(result.success).toBe(true);
  });

  it('marca success=false cuando fallan todos los parseos', async () => {
    const result = await new FakeScraper([], 3).run();
    expect(result.errors).toHaveLength(3);
    expect(result.success).toBe(false);
  });

  it('no añade errores cuando no hay fallos', async () => {
    const result = await new FakeScraper(['a', 'b'], 0).run();
    expect(result.errors).toEqual([]);
    expect(result.success).toBe(true);
  });

  it('expone el umbral de fallo como constante', () => {
    expect(PARSE_FAILURE_RATIO).toBeGreaterThan(0);
    expect(PARSE_FAILURE_RATIO).toBeLessThanOrEqual(1);
  });
});

/**
 * Integración de loadSummaries (scrape-health-watch): que coja el ÚLTIMO run
 * por (scraper_key, entity_type) de scrape_logs, que es lo que evalúa la
 * detección de éxito silencioso (I3). La lógica de decisión ya está cubierta
 * por el unitario apps/etl/src/scrape-health.test.ts.
 */
import { describe, test, expect, beforeEach, afterAll } from 'vitest';
import { db, closeDb, insertScrapeLog } from '@sports/db';
import { limpiar } from './support/db.js';
import { loadSummaries } from '../../apps/etl/src/scrape-health-watch.js';
import { evaluateScrapeHealth } from '../../apps/etl/src/scrape-health.js';

beforeEach(async () => { await limpiar(); });
afterAll(async () => { await closeDb(); });

describe('scrape-health · loadSummaries', () => {
  test('coge el run más reciente por scraper y detecta el éxito silencioso', async () => {
    // Un run viejo con datos y, después, uno reciente con 0 resultados.
    await insertScrapeLog({ scraperKey: 'fep_hockey', entityType: 'match', status: 'success', recordsFound: 20 });
    // Fuerza que el reciente sea posterior.
    await db.query(`UPDATE scrape_logs SET scraped_at = NOW() - interval '2 hours'`);
    await insertScrapeLog({ scraperKey: 'fep_hockey', entityType: 'match', status: 'success', recordsFound: 0 });

    const summaries = await loadSummaries();
    const match = summaries.find((s) => s.scraperKey === 'fep_hockey' && s.entityType === 'match');
    expect(match).toBeDefined();
    expect(match!.lastRecordsFound).toBe(0); // el reciente, no el viejo de 20

    const alerts = evaluateScrapeHealth(new Date(), summaries, { staleHours: 26 });
    expect(alerts).toEqual([{ kind: 'zero', scraperKey: 'fep_hockey', entityType: 'match' }]);
  });
});

import { describe, it, expect } from 'vitest';
import { evaluateScrapeHealth, type ScrapeSummary } from './scrape-health.js';

const NOW = new Date('2026-09-25T12:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

function sum(over: Partial<ScrapeSummary>): ScrapeSummary {
  return {
    scraperKey: 'fep_hockey',
    entityType: 'match',
    lastScrapedAt: hoursAgo(1),
    lastStatus: 'success',
    lastRecordsFound: 10,
    ...over,
  };
}

describe('evaluateScrapeHealth', () => {
  it('no alerta cuando un scraper corrió reciente con resultados', () => {
    const alerts = evaluateScrapeHealth(NOW, [sum({})], { staleHours: 26 });
    expect(alerts).toEqual([]);
  });

  it('alerta STALE si el último run supera el umbral', () => {
    const alerts = evaluateScrapeHealth(NOW, [sum({ lastScrapedAt: hoursAgo(30) })], { staleHours: 26 });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: 'stale', scraperKey: 'fep_hockey', entityType: 'match' });
    expect((alerts[0] as { ageHours: number }).ageHours).toBeGreaterThanOrEqual(30);
  });

  it('alerta ZERO cuando un run reciente tuvo éxito con 0 resultados (éxito silencioso)', () => {
    const alerts = evaluateScrapeHealth(NOW, [sum({ lastStatus: 'success', lastRecordsFound: 0 })], { staleHours: 26 });
    expect(alerts).toEqual([{ kind: 'zero', scraperKey: 'fep_hockey', entityType: 'match' }]);
  });

  it('NO alerta ZERO ante un error (eso ya lo captura Sentry por otra vía)', () => {
    const alerts = evaluateScrapeHealth(NOW, [sum({ lastStatus: 'error', lastRecordsFound: 0 })], { staleHours: 26 });
    expect(alerts).toEqual([]);
  });

  it('STALE tiene prioridad sobre ZERO (viejo + 0 → una sola alerta, stale)', () => {
    const alerts = evaluateScrapeHealth(NOW, [sum({ lastScrapedAt: hoursAgo(40), lastStatus: 'success', lastRecordsFound: 0 })], { staleHours: 26 });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.kind).toBe('stale');
  });

  it('alerta MISSING si un scraper esperado no aparece en absoluto', () => {
    const alerts = evaluateScrapeHealth(NOW, [sum({ scraperKey: 'fep_hockey' })], {
      staleHours: 26,
      expectedKeys: ['fep_hockey', 'worldskate'],
    });
    expect(alerts).toEqual([{ kind: 'missing', scraperKey: 'worldskate' }]);
  });
});

import { describe, it, expect } from 'vitest';
import {
  evaluateScrapeHealth, ScrapeFailureTracker, alertMessage, type ScrapeSummary,
} from './scrape-health.js';

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

  it('alerta ERROR cuando el último run terminó con error', () => {
    const alerts = evaluateScrapeHealth(NOW, [sum({ lastStatus: 'error', lastRecordsFound: 0 })], { staleHours: 26 });
    expect(alerts).toEqual([{ kind: 'error', scraperKey: 'fep_hockey', entityType: 'match' }]);
  });

  it('un error con resultados también alerta (no es sólo el caso "0 filas")', () => {
    const alerts = evaluateScrapeHealth(NOW, [sum({ lastStatus: 'error', lastRecordsFound: 5 })], { staleHours: 26 });
    expect(alerts).toEqual([{ kind: 'error', scraperKey: 'fep_hockey', entityType: 'match' }]);
  });

  it('incluye el mensaje de error en la alerta cuando está disponible', () => {
    const alerts = evaluateScrapeHealth(
      NOW,
      [sum({ lastStatus: 'error', lastErrorMessage: 'HTTP 404 en https://…' })],
      { staleHours: 26 },
    );
    expect(alerts).toEqual([{
      kind: 'error', scraperKey: 'fep_hockey', entityType: 'match',
      errorMessage: 'HTTP 404 en https://…',
    }]);
  });

  it('no alerta ERROR y ZERO a la vez (el error manda)', () => {
    const alerts = evaluateScrapeHealth(NOW, [sum({ lastStatus: 'error', lastRecordsFound: 0 })], { staleHours: 26 });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.kind).toBe('error');
  });

  it('STALE tiene prioridad sobre ZERO (viejo + 0 → una sola alerta, stale)', () => {
    const alerts = evaluateScrapeHealth(NOW, [sum({ lastScrapedAt: hoursAgo(40), lastStatus: 'success', lastRecordsFound: 0 })], { staleHours: 26 });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.kind).toBe('stale');
  });

  it('STALE tiene prioridad sobre ERROR (viejo + error → una sola alerta, stale)', () => {
    const alerts = evaluateScrapeHealth(NOW, [sum({ lastScrapedAt: hoursAgo(40), lastStatus: 'error' })], { staleHours: 26 });
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

describe('alertMessage', () => {
  it('describe un error con su mensaje para que la alerta sea accionable', () => {
    const msg = alertMessage({
      kind: 'error', scraperKey: 'worldskate_hockey', entityType: 'match',
      errorMessage: 'HTTP 404 en worldskate_cal_idc_320_1.php',
    });
    expect(msg).toContain('worldskate_hockey/match');
    expect(msg).toContain('HTTP 404');
  });

  it('describe un error sin mensaje sin dejar texto colgando', () => {
    const msg = alertMessage({ kind: 'error', scraperKey: 'fep_hockey', entityType: 'match' });
    expect(msg).toContain("falló en su último run");
    expect(msg).not.toContain(':');
  });
});

describe('ScrapeFailureTracker', () => {
  it('no señala nada hasta N fallos consecutivos', () => {
    const t = new ScrapeFailureTracker(3);
    expect(t.observe('worldskate_hockey', false)).toBe(false); // 1
    expect(t.observe('worldskate_hockey', false)).toBe(false); // 2
  });

  it('señala al alcanzar el umbral de fallos consecutivos', () => {
    const t = new ScrapeFailureTracker(3);
    t.observe('worldskate_hockey', false);
    t.observe('worldskate_hockey', false);
    expect(t.observe('worldskate_hockey', false)).toBe(true); // 3 → alertar
  });

  it('un éxito resetea la cuenta de esa fuente', () => {
    const t = new ScrapeFailureTracker(3);
    t.observe('worldskate_hockey', false);
    t.observe('worldskate_hockey', false);
    expect(t.observe('worldskate_hockey', true)).toBe(false);
    expect(t.observe('worldskate_hockey', false)).toBe(false); // 1 otra vez
    expect(t.observe('worldskate_hockey', false)).toBe(false); // 2
    expect(t.observe('worldskate_hockey', false)).toBe(true);  // 3
  });

  it('sólo señala una vez por racha (no alerta en cada ciclo posterior)', () => {
    const t = new ScrapeFailureTracker(2);
    expect(t.observe('a', false)).toBe(false); // 1
    expect(t.observe('a', false)).toBe(true);  // 2 → alerta
    expect(t.observe('a', false)).toBe(false); // sigue fallando, no re-alerta
    expect(t.observe('a', true)).toBe(false);  // se recupera
    expect(t.observe('a', false)).toBe(false); // 1
    expect(t.observe('a', false)).toBe(true);  // nueva racha → vuelve a alertar
  });

  it('lleva cuentas independientes por fuente', () => {
    const t = new ScrapeFailureTracker(2);
    expect(t.observe('a', false)).toBe(false);
    expect(t.observe('b', false)).toBe(false);
    expect(t.observe('a', false)).toBe(true);  // a llega a 2
    expect(t.observe('b', false)).toBe(true);  // b tambien
  });

  it('hasFailing indica si alguna fuente supera el umbral ahora mismo', () => {
    const t = new ScrapeFailureTracker(2);
    t.observe('a', false);
    expect(t.hasFailing()).toBe(false);
    t.observe('a', false);
    expect(t.hasFailing()).toBe(true);
    t.observe('a', true);
    expect(t.hasFailing()).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { SITEMAP_DROP_THRESHOLD, sitemapDropPct, shouldAlertSitemapDrop } from './sitemap-state.js';

describe('shouldAlertSitemapDrop (F1-8)', () => {
  it('avisa solo si la caída es MAYOR que el 20 %', () => {
    expect(shouldAlertSitemapDrop(100, 80)).toBe(false);
    expect(shouldAlertSitemapDrop(100, 79)).toBe(true);
    expect(shouldAlertSitemapDrop(50, 40)).toBe(false);
    expect(shouldAlertSitemapDrop(50, 39)).toBe(true);
    expect(shouldAlertSitemapDrop(100, 120)).toBe(false);
  });

  it('no avisa sin una generación anterior válida', () => {
    for (const previous of [null, undefined, 0, -1]) {
      expect(shouldAlertSitemapDrop(previous, 10), String(previous)).toBe(false);
    }
  });

  it('el umbral es el 20 %', () => {
    expect(SITEMAP_DROP_THRESHOLD).toBe(0.2);
  });
});

describe('sitemapDropPct', () => {
  it('devuelve el porcentaje de caída redondeado', () => {
    expect(sitemapDropPct(100, 79)).toBe(21);
    expect(sitemapDropPct(100, 100)).toBe(0);
    expect(sitemapDropPct(100, 120)).toBe(-20);
  });

  it('devuelve null sin generación anterior', () => {
    expect(sitemapDropPct(null, 10)).toBeNull();
    expect(sitemapDropPct(0, 10)).toBeNull();
  });
});

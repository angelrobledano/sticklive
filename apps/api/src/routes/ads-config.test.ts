import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

import { buildAdsConfig } from './ads-config.js';

describe('buildAdsConfig', () => {
  it('default: todo desactivado (fail-safe — la activación es explícita)', () => {
    const cfg = buildAdsConfig({});
    expect(cfg).toEqual({
      appOpen: { enabled: false, minIntervalHours: 4 },
      interstitial: { enabled: false, minIntervalMinutes: 20, maxPerHour: 2 },
      rewarded: { enabled: false, adfreeMinutes: 30 },
      nativeFeed: { enabled: false, everyNItems: 8 },
    });
  });

  it('envs activan formatos y overridean caps', () => {
    const cfg = buildAdsConfig({
      ADS_APP_OPEN_ENABLED: '1',
      ADS_INTERSTITIAL_ENABLED: 'true',
      ADS_REWARDED_ENABLED: '1',
      ADS_REWARDED_ADFREE_MINUTES: '60',
      ADS_NATIVE_FEED_EVERY: '6',
    });
    expect(cfg.appOpen.enabled).toBe(true);
    expect(cfg.interstitial.enabled).toBe(true);
    expect(cfg.rewarded).toEqual({ enabled: true, adfreeMinutes: 60 });
    expect(cfg.nativeFeed).toEqual({ enabled: true, everyNItems: 6 });
  });

  it('valores basura caen al default (nunca inventar)', () => {
    const cfg = buildAdsConfig({
      ADS_APP_OPEN_ENABLED: 'yes',
      ADS_NATIVE_FEED_EVERY: 'cero',
      ADS_REWARDED_ADFREE_MINUTES: '-5',
    });
    expect(cfg.appOpen.enabled).toBe(false);
    expect(cfg.nativeFeed.everyNItems).toBe(8);
    expect(cfg.nativeFeed.enabled).toBe(false); // un typo en EVERY nunca activa el formato
    expect(cfg.rewarded.adfreeMinutes).toBe(30);
  });

  it('ADS_NATIVE_FEED_ENABLED=1 activa el formato aunque falte EVERY', () => {
    const cfg = buildAdsConfig({ ADS_NATIVE_FEED_ENABLED: '1' });
    expect(cfg.nativeFeed).toEqual({ enabled: true, everyNItems: 8 });
  });

  it('ENABLED=false explícito apaga nativeFeed aunque el EVERY sea válido', () => {
    const cfg = buildAdsConfig({ ADS_NATIVE_FEED_ENABLED: 'false', ADS_NATIVE_FEED_EVERY: '6' });
    expect(cfg.nativeFeed.enabled).toBe(false);
    expect(cfg.nativeFeed.everyNItems).toBe(6);
  });

  it('ENABLED=basura apaga nativeFeed aunque el EVERY sea válido (fail-closed)', () => {
    const cfg = buildAdsConfig({ ADS_NATIVE_FEED_ENABLED: 'quizas', ADS_NATIVE_FEED_EVERY: '6' });
    expect(cfg.nativeFeed.enabled).toBe(false);
  });

  it('caps con env válido se overridean; cero y no-entero caen al default', () => {
    const cfg = buildAdsConfig({
      ADS_APP_OPEN_MIN_INTERVAL_HOURS: '2',
      ADS_INTERSTITIAL_MIN_INTERVAL_MINUTES: '45',
      ADS_INTERSTITIAL_MAX_PER_HOUR: '3',
      ADS_NATIVE_FEED_EVERY: '0', // 0 no es positivo → default
      ADS_REWARDED_ADFREE_MINUTES: '2.5', // no entero → default
    });
    expect(cfg.appOpen.minIntervalHours).toBe(2);
    expect(cfg.interstitial).toEqual({ enabled: false, minIntervalMinutes: 45, maxPerHour: 3 });
    expect(cfg.nativeFeed.everyNItems).toBe(8);
    expect(cfg.rewarded.adfreeMinutes).toBe(30);
  });
});

// ── Router ───────────────────────────────────────────────────────────────────

// El endpoint lee process.env en cada petición: fijamos los envs de activación
// a vacío para que el test sea determinista aunque la máquina tenga alguno.
const ADS_ENVS = [
  'ADS_APP_OPEN_ENABLED',
  'ADS_INTERSTITIAL_ENABLED',
  'ADS_REWARDED_ENABLED',
  'ADS_NATIVE_FEED_ENABLED',
] as const;

describe('GET /ads/config', () => {
  beforeEach(() => {
    for (const k of ADS_ENVS) vi.stubEnv(k, '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('200 con la config default y Cache-Control público', async () => {
    const app = new Hono();
    app.route('/ads/config', (await import('./ads-config.js')).adsConfigRouter);

    const res = await app.request('/ads/config');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      appOpen: { enabled: false, minIntervalHours: 4 },
      interstitial: { enabled: false, minIntervalMinutes: 20, maxPerHour: 2 },
      rewarded: { enabled: false, adfreeMinutes: 30 },
      nativeFeed: { enabled: false, everyNItems: 8 },
    });
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=300');
  });

  it('200 con envs de activación (la config manda en runtime, sin rebuild de la app)', async () => {
    vi.stubEnv('ADS_REWARDED_ENABLED', '1');
    const app = new Hono();
    app.route('/ads/config', (await import('./ads-config.js')).adsConfigRouter);

    const res = await app.request('/ads/config');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rewarded: { enabled: boolean; adfreeMinutes: number } };
    expect(body.rewarded).toEqual({ enabled: true, adfreeMinutes: 30 });
  });
});

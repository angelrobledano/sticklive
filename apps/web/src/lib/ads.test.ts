import { describe, it, expect } from 'vitest';
import {
  adSlotLayout,
  adsEnabled,
  listAdInsertIndex,
  shouldShowInterstitial,
  buildAdsenseConfig,
  LIST_AD_EVERY_DEFAULT,
  INTERSTITIAL_MIN_INTERVAL_MS,
} from './ads';

describe('adsEnabled', () => {
  // El consentimiento publicitario lo gobierna el CMP de Google (TCF) a través
  // del propio tag de AdSense; por eso `adsEnabled` NO depende del
  // consentimiento de analítica (ver docs/monetizacion.md §4).
  it('habilita anuncios con cliente configurado y sin premium', () => {
    expect(adsEnabled({ client: 'ca-pub-123', premium: false })).toBe(true);
  });

  it('nunca habilita para Premium', () => {
    expect(adsEnabled({ client: 'ca-pub-123', premium: true })).toBe(false);
  });

  it('requiere un cliente configurado (no vacío)', () => {
    expect(adsEnabled({ client: '', premium: false })).toBe(false);
    expect(adsEnabled({ client: '   ', premium: false })).toBe(false);
    expect(adsEnabled({ client: undefined, premium: false })).toBe(false);
    expect(adsEnabled({ client: null, premium: false })).toBe(false);
  });
});

describe('listAdInsertIndex', () => {
  it('inserta tras el bloque por defecto cuando hay más de `every` elementos', () => {
    expect(listAdInsertIndex(5)).toBe(LIST_AD_EVERY_DEFAULT);
    expect(listAdInsertIndex(9)).toBe(4);
  });

  it('no inserta si el anuncio quedaría al final o en listas cortas', () => {
    expect(listAdInsertIndex(0)).toBe(-1);
    expect(listAdInsertIndex(1)).toBe(-1);
    expect(listAdInsertIndex(4)).toBe(-1);
  });

  it('respeta un intervalo personalizado', () => {
    expect(listAdInsertIndex(3, 2)).toBe(2);
    expect(listAdInsertIndex(2, 2)).toBe(-1);
  });

  it('desactiva la inserción con un intervalo <= 0 o valores inválidos', () => {
    expect(listAdInsertIndex(100, 0)).toBe(-1);
    expect(listAdInsertIndex(100, -3)).toBe(-1);
    expect(listAdInsertIndex(Number.NaN)).toBe(-1);
    expect(listAdInsertIndex(100, Number.NaN)).toBe(-1);
  });
});

describe('shouldShowInterstitial', () => {
  const base = {
    enabled: true,
    premium: false,
    alreadyShownThisSession: false,
    lastShownAt: null as number | null,
    nowMs: 10_000_000,
  };

  it('muestra el intersticial cuando procede', () => {
    expect(shouldShowInterstitial(base)).toBe(true);
  });

  it('no muestra si está desactivado o es Premium', () => {
    expect(shouldShowInterstitial({ ...base, enabled: false })).toBe(false);
    expect(shouldShowInterstitial({ ...base, premium: true })).toBe(false);
  });

  it('limita a uno por sesión', () => {
    expect(shouldShowInterstitial({ ...base, alreadyShownThisSession: true })).toBe(false);
  });

  it('aplica el intervalo mínimo por defecto (6 h)', () => {
    const now = base.nowMs;
    expect(shouldShowInterstitial({ ...base, lastShownAt: now - INTERSTITIAL_MIN_INTERVAL_MS - 1 })).toBe(true);
    expect(shouldShowInterstitial({ ...base, lastShownAt: now - INTERSTITIAL_MIN_INTERVAL_MS + 1 })).toBe(false);
  });

  it('respeta un intervalo mínimo explícito', () => {
    const now = 1_000_000;
    expect(shouldShowInterstitial({ ...base, nowMs: now, lastShownAt: now - 500, minIntervalMs: 1_000 })).toBe(false);
    expect(shouldShowInterstitial({ ...base, nowMs: now, lastShownAt: now - 1_500, minIntervalMs: 1_000 })).toBe(true);
  });

  it('trata un `lastShownAt` inválido como nunca mostrado', () => {
    expect(shouldShowInterstitial({ ...base, lastShownAt: Number.NaN })).toBe(true);
  });
});

describe('buildAdsenseConfig', () => {
  it('por defecto queda desconfigurado y con la lista a 4', () => {
    const config = buildAdsenseConfig();
    expect(config.client).toBe('');
    expect(config.slots).toEqual({});
    expect(config.listEvery).toBe(LIST_AD_EVERY_DEFAULT);
    expect(config.interstitialEnabled).toBe(false);
  });

  it('normaliza el cliente y los slots por zona', () => {
    const config = buildAdsenseConfig({
      client: '  ca-pub-999  ',
      slotHomeTop: '111',
      slotListInline: '222',
      slotMatchSummary: '333',
      slotInterstitial: '444',
    });
    expect(config.client).toBe('ca-pub-999');
    expect(config.slots['home-top']).toBe('111');
    expect(config.slots['list-inline']).toBe('222');
    expect(config.slots['match-summary']).toBe('333');
    expect(config.slots['interstitial']).toBe('444');
  });

  it('parsea el intervalo de la lista y tolera valores inválidos', () => {
    expect(buildAdsenseConfig({ listEvery: '6' }).listEvery).toBe(6);
    expect(buildAdsenseConfig({ listEvery: 'abc' }).listEvery).toBe(LIST_AD_EVERY_DEFAULT);
    expect(buildAdsenseConfig({ listEvery: '0' }).listEvery).toBe(0);
    expect(buildAdsenseConfig({ listEvery: '-4' }).listEvery).toBe(0);
  });

  it('activa el intersticial solo con "1"', () => {
    expect(buildAdsenseConfig({ interstitial: '1' }).interstitialEnabled).toBe(true);
    expect(buildAdsenseConfig({ interstitial: '0' }).interstitialEnabled).toBe(false);
    expect(buildAdsenseConfig({ interstitial: 'true' }).interstitialEnabled).toBe(false);
    expect(buildAdsenseConfig({}).interstitialEnabled).toBe(false);
  });
});

describe('adSlotLayout (auditoría UX #1)', () => {
  it('las zonas de lista no se expanden a pantalla completa', () => {
    for (const z of ['home-top', 'home-inline', 'list-inline'] as const) {
      expect(adSlotLayout(z)).toEqual({ fullWidthResponsive: false });
    }
  });
  it('las zonas de ficha mantienen el formato responsive', () => {
    expect(adSlotLayout('match-summary')).toEqual({ fullWidthResponsive: true });
  });
});

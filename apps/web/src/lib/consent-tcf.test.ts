import { describe, it, expect } from 'vitest';
import { analyticsAllowedFromTcData, resolveAnalyticsConsent } from './consent-tcf';
import { parseFallbackConsent } from './consent-fallback';

describe('analyticsAllowedFromTcData', () => {
  it('sin datos o sin éxito → no permitido (fail-closed)', () => {
    expect(analyticsAllowedFromTcData(null)).toBe(false);
    expect(analyticsAllowedFromTcData(undefined)).toBe(false);
  });

  it('fuera del EEE (gdprApplies false) → permitido', () => {
    expect(analyticsAllowedFromTcData({ gdprApplies: false })).toBe(true);
  });

  it('exige los propósitos TCF 1 y 7', () => {
    expect(analyticsAllowedFromTcData({ gdprApplies: true, purposeConsents: { '1': true, '7': true } })).toBe(true);
    expect(analyticsAllowedFromTcData({ gdprApplies: true, purposeConsents: { '1': true } })).toBe(false);
    expect(analyticsAllowedFromTcData({ gdprApplies: true, purposeConsents: { '7': true } })).toBe(false);
    expect(analyticsAllowedFromTcData({ gdprApplies: true, purposeConsents: { '1': false, '7': true } })).toBe(false);
  });
});

describe('resolveAnalyticsConsent', () => {
  it('una decisión explícita del CMP manda sobre el respaldo', () => {
    expect(resolveAnalyticsConsent('granted', 'denied')).toBe('granted');
    expect(resolveAnalyticsConsent('denied', 'granted')).toBe('denied');
  });

  it('si el CMP está pendiente o no disponible, manda el respaldo', () => {
    expect(resolveAnalyticsConsent('pending', 'granted')).toBe('granted');
    expect(resolveAnalyticsConsent('pending', 'denied')).toBe('denied');
    expect(resolveAnalyticsConsent('unavailable', 'granted')).toBe('granted');
    expect(resolveAnalyticsConsent('unavailable', 'pending')).toBe('pending');
  });
});

describe('parseFallbackConsent', () => {
  it('solo acepta granted/denied; el resto es pending', () => {
    expect(parseFallbackConsent('granted')).toBe('granted');
    expect(parseFallbackConsent('denied')).toBe('denied');
    expect(parseFallbackConsent('pending')).toBe('pending');
    expect(parseFallbackConsent(null)).toBe('pending');
    expect(parseFallbackConsent('otra-cosa')).toBe('pending');
  });
});

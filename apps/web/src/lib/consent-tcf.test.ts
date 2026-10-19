import { describe, it, expect } from 'vitest';
import { analyticsAllowedFromTcData } from './consent-tcf';

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

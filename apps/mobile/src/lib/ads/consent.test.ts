import { describe, expect, it, vi } from 'vitest';

import { canRequestAdsAfterConsent } from './consent';

// El SDK de ads es código NATIVO: en vitest (node) no existe y hay que
// mockearlo para que la importación de './consent' no explote (patrón del
// repo: push.test.ts / session.test.ts). El wrapper requestAdsConsent() NO se
// testea aquí — se fuma en device con development build (Task 5).
vi.mock('react-native-google-mobile-ads', () => ({
  AdsConsent: {
    gatherConsent: vi.fn(),
    getConsentInfo: vi.fn(),
  },
}));

// La decisión de consentimiento es la puerta de las ads: solo un `true`
// EXPLÍCITO del UMP abre — cualquier otra cosa (false, undefined, null) es
// fail-closed, igual que shouldShowAds con premium desconocido.
describe('canRequestAdsAfterConsent', () => {
  it('consentimiento concedido ⇒ se pueden pedir ads', () => {
    expect(canRequestAdsAfterConsent({ canRequestAds: true })).toEqual({
      canRequestAds: true,
    });
  });

  it('consentimiento denegado ⇒ sin ads', () => {
    expect(canRequestAdsAfterConsent({ canRequestAds: false })).toEqual({
      canRequestAds: false,
    });
  });

  it('valor indefinido del SDK ⇒ fail-closed (coerción explícita)', () => {
    expect(
      canRequestAdsAfterConsent({ canRequestAds: undefined as unknown as boolean })
    ).toEqual({ canRequestAds: false });
  });
});

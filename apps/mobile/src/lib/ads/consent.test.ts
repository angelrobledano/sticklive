import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdsConsent } from 'react-native-google-mobile-ads';
import type {
  AdsConsentInfo,
  AdsConsentPrivacyOptionsRequirementStatus,
  AdsConsentStatus,
} from 'react-native-google-mobile-ads';

import { canRequestAdsAfterConsent, requestAdsConsent } from './consent';

// El SDK de ads es código NATIVO: en vitest (node) no existe y hay que
// mockearlo para que la importación de './consent' no explote (patrón del
// repo: push.test.ts / session.test.ts). La ORQUESTACIÓN del wrapper sí se
// testea aquí (pass-through de opciones y propagación de errores); lo que
// se fuma en device con development build es el comportamiento real del
// formulario UMP y la geografía de debug (Task 5).
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

  it('valor null del SDK ⇒ fail-closed (misma coerción)', () => {
    expect(
      canRequestAdsAfterConsent({ canRequestAds: null as unknown as boolean })
    ).toEqual({ canRequestAds: false });
  });
});

describe('requestAdsConsent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Literales casteadas a los enums del SDK (imports SOLO de tipo: en runtime
  // el módulo está mockeado y los enums no existen).
  const OBTAINED: AdsConsentInfo = {
    status: 'OBTAINED' as AdsConsentStatus,
    canRequestAds: true,
    privacyOptionsRequirementStatus:
      'NOT_REQUIRED' as AdsConsentPrivacyOptionsRequirementStatus,
    isConsentFormAvailable: true,
  };

  it('pasa opciones (o ausencia de ellas) a gatherConsent y decide con getConsentInfo', async () => {
    vi.mocked(AdsConsent.gatherConsent).mockResolvedValue(OBTAINED);
    vi.mocked(AdsConsent.getConsentInfo).mockResolvedValue(OBTAINED);

    // Con opciones (smoke EEA de Task 5: debugGeography / testDeviceIdentifiers).
    const withOptions = await requestAdsConsent({ tagForUnderAgeOfConsent: true });

    expect(withOptions).toEqual({ canRequestAds: true });
    expect(AdsConsent.gatherConsent).toHaveBeenCalledWith({ tagForUnderAgeOfConsent: true });
    expect(AdsConsent.getConsentInfo).toHaveBeenCalledTimes(1);

    // Producción llama SIN opciones: gatherConsent recibe undefined (mismo
    // comportamiento que antes del pass-through).
    await requestAdsConsent();

    expect(AdsConsent.gatherConsent).toHaveBeenLastCalledWith(undefined);
  });

  it('gatherConsent rechaza ⇒ el wrapper PROPAGA (el fallback es del llamador)', async () => {
    vi.mocked(AdsConsent.gatherConsent).mockRejectedValue(new Error('ump offline'));

    await expect(requestAdsConsent()).rejects.toThrow('ump offline');
    // El wrapper NO consulta la sesión previa por su cuenta: esa decisión
    // (con su log de degradación) es del flujo que llama (AdBanner).
    expect(AdsConsent.getConsentInfo).not.toHaveBeenCalled();
  });
});

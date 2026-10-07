import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdsConsent } from 'react-native-google-mobile-ads';
import type {
  AdsConsentInfo,
  AdsConsentPrivacyOptionsRequirementStatus,
  AdsConsentStatus,
} from 'react-native-google-mobile-ads';

import { canRequestAdsAfterConsent, manageAdsConsent, requestAdsConsent } from './consent';

// El SDK de ads es código NATIVO: en vitest (node) no existe y hay que
// mockearlo para que la importación de './consent' no explote (patrón del
// repo: push.test.ts / session.test.ts). La ORQUESTACIÓN del wrapper sí se
// testea aquí (pass-through de opciones y propagación de errores); lo que
// se fuma en device con development build es el comportamiento real del
// formulario UMP y la geografía de debug (Task 5).
vi.mock('react-native-google-mobile-ads', () => ({
  AdsConsentPrivacyOptionsRequirementStatus: {
    UNKNOWN: 'UNKNOWN',
    REQUIRED: 'REQUIRED',
    NOT_REQUIRED: 'NOT_REQUIRED',
  },
  AdsConsent: {
    gatherConsent: vi.fn(),
    getConsentInfo: vi.fn(),
    showPrivacyOptionsForm: vi.fn(),
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

describe('manageAdsConsent (re-consentimiento desde Ajustes, Plan D Task 3)', () => {
  // resetAllMocks (no clearAllMocks): mockClear NO limpia implementaciones y
  // un mockResolvedValue de un test anterior filtraría en la cola de este
  // describe cuando la cola de mockResolvedValueOnce se agota.
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // EEA con consentimiento ya OBTENIDO: gatherConsent NO abre formulario
  // (solo lo hace si es requerido) — el cambio de elección vive en el
  // formulario de OPCIONES DE PRIVACIDAD.
  const PRIVACY_REQUIRED: AdsConsentInfo = {
    status: 'OBTAINED' as AdsConsentStatus,
    canRequestAds: true,
    privacyOptionsRequirementStatus: 'REQUIRED' as AdsConsentPrivacyOptionsRequirementStatus,
    isConsentFormAvailable: true,
  };
  const PRIVACY_NOT_REQUIRED: AdsConsentInfo = {
    status: 'OBTAINED' as AdsConsentStatus,
    canRequestAds: true,
    privacyOptionsRequirementStatus: 'NOT_REQUIRED' as AdsConsentPrivacyOptionsRequirementStatus,
    isConsentFormAvailable: true,
  };

  it('re-ejecuta el flujo UMP REAL (gatherConsent, no la promesa cacheada) y sin formulario extra si no es requerido', async () => {
    vi.mocked(AdsConsent.gatherConsent).mockResolvedValue(PRIVACY_NOT_REQUIRED);
    vi.mocked(AdsConsent.getConsentInfo).mockResolvedValue(PRIVACY_NOT_REQUIRED);

    const state = await manageAdsConsent();

    expect(state).toEqual({ canRequestAds: true });
    expect(AdsConsent.gatherConsent).toHaveBeenCalledTimes(1);
    expect(AdsConsent.gatherConsent).toHaveBeenCalledWith(undefined);
    expect(AdsConsent.showPrivacyOptionsForm).not.toHaveBeenCalled();
  });

  it('pasa opciones intactas (el smoke EEA de Task 5 usa debugGeography por aquí)', async () => {
    vi.mocked(AdsConsent.gatherConsent).mockResolvedValue(PRIVACY_NOT_REQUIRED);
    vi.mocked(AdsConsent.getConsentInfo).mockResolvedValue(PRIVACY_NOT_REQUIRED);

    await manageAdsConsent({ tagForUnderAgeOfConsent: true });

    expect(AdsConsent.gatherConsent).toHaveBeenCalledWith({ tagForUnderAgeOfConsent: true });
  });

  it('con opciones de privacidad REQUERIDAS, abre el formulario de opciones y RELEE la decisión', async () => {
    vi.mocked(AdsConsent.gatherConsent).mockResolvedValue(PRIVACY_REQUIRED);
    vi.mocked(AdsConsent.getConsentInfo)
      .mockResolvedValueOnce(PRIVACY_REQUIRED) // 1ª: decisión inicial (requestAdsConsent)
      .mockResolvedValueOnce(PRIVACY_REQUIRED) // 2ª: check del requisito de opciones
      .mockResolvedValueOnce({
        ...PRIVACY_REQUIRED,
        canRequestAds: false, // el usuario RECHAZÓ en el formulario de opciones
      } as AdsConsentInfo); // 3ª: RE-LECTURA tras el formulario

    const state = await manageAdsConsent();

    expect(AdsConsent.showPrivacyOptionsForm).toHaveBeenCalledTimes(1);
    // La decisión devuelta es la POST-formulario: el usuario pudo cambiarla.
    expect(state).toEqual({ canRequestAds: false });
  });

  it('cualquier fallo del flujo PROPAGA (la pantalla decide qué mostrar)', async () => {
    vi.mocked(AdsConsent.gatherConsent).mockRejectedValue(new Error('ump offline'));

    await expect(manageAdsConsent()).rejects.toThrow('ump offline');
    expect(AdsConsent.showPrivacyOptionsForm).not.toHaveBeenCalled();
  });

  it('el formulario de opciones rechaza ⇒ PROPAGA (reintentable desde la pantalla)', async () => {
    vi.mocked(AdsConsent.gatherConsent).mockResolvedValue(PRIVACY_REQUIRED);
    vi.mocked(AdsConsent.getConsentInfo).mockResolvedValue(PRIVACY_REQUIRED);
    vi.mocked(AdsConsent.showPrivacyOptionsForm).mockRejectedValue(new Error('form offline'));

    await expect(manageAdsConsent()).rejects.toThrow('form offline');
  });
});

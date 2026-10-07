import { AdsConsent } from 'react-native-google-mobile-ads';

/**
 * Consentimiento UMP (Google) — equivalente del CMP web (docs/monetizacion.md
 * §4). Sin consentimiento NO se sirven ads: la superficie se colapsa.
 *
 * El wrapper sigue EXACTAMENTE la doc instalada del SDK
 * (react-native-google-mobile-ads@17: `AdsConsent.gatherConsent()` =
 * requestInfoUpdate + loadAndShowConsentFormIfRequired, y la decisión sobre
 * `canRequestAds` se lee con `getConsentInfo()` — patrón de su guía
 * "European user consent"). La DECISIÓN es pura y testeable
 * (`canRequestAdsAfterConsent`); la llamada al UMP es fina.
 *
 * IMPORTANTE (doc del SDK): el consentimiento se recoge ANTES de
 * `mobileAds().initialize()` — en init pueden precargarse ads.
 */
export interface AdsConsentState {
  canRequestAds: boolean;
}

/**
 * Decisión pura: solo `canRequestAds === true` habilita ads. La coerción
 * explícita hace fail-closed ante cualquier valor falsy que el SDK devuelva
 * (p. ej. `undefined`): sin certeza de consentimiento, no hay ads.
 */
export function canRequestAdsAfterConsent(info: {
  canRequestAds: boolean;
}): AdsConsentState {
  return { canRequestAds: info.canRequestAds === true };
}

/**
 * Orquestación UMP según la doc instalada: pide actualización del estado de
 * consentimiento, muestra el formulario SOLO si es requerido y devuelve la
 * decisión final. Llamar en cada arranque de app (la doc lo recomienda: el
 * consentimiento puede expirar o cambiar el mensaje).
 *
 * `options` pasa INTACTO a `AdsConsent.gatherConsent()`: producción lo llama
 * sin opciones (comportamiento idéntico), y el smoke EEA (Task 5) pasa en el
 * call-site `debugGeography` / `testDeviceIdentifiers` — no se cocinan aquí.
 *
 * Los ERRORES se PROPAGAN (nunca silencio): si gatherConsent falla, la doc
 * permite reintentar con el estado de la sesión anterior — esa decisión es
 * del llamador (Task 4), que decide qué mostrar.
 */
export async function requestAdsConsent(
  options?: Parameters<typeof AdsConsent.gatherConsent>[0],
): Promise<AdsConsentState> {
  await AdsConsent.gatherConsent(options);
  const info = await AdsConsent.getConsentInfo();
  return canRequestAdsAfterConsent(info);
}

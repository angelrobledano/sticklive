import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import {
  AdEventType,
  RewardedAd,
  RewardedAdEventType,
  TestIds,
} from 'react-native-google-mobile-ads';

import { ensureAdsConsent, ensureSdkInitialized, resetAdsConsent } from './AdBanner';
import { useLocale } from '@/src/i18n/LocaleContext';
import { useAdsConfig } from '@/src/hooks/queries';
import { usePremiumStatus } from '@/src/hooks/usePremiumStatus';
import { capture } from '@/src/lib/analytics';
import { grantAdfreeReward, REWARD_TYPE, setAdfreeUntil, getAdfreeUntil } from '@/src/lib/ads/adfree';

/**
 * <RewardedCard /> — ad-free recompensado (Plan D Task 2), en la pantalla
 * Premium bajo los productos: "mira un anuncio → N minutos sin anuncios",
 * ACUMULABLES (extendAdfree desde la caducidad vigente, no desde ahora): el
 * CTA se vuelve a habilitar tras cada concesión en cuanto el siguiente
 * anuncio está listo.
 *
 * Fail-closed TOTAL antes de existir: solo se renderiza con no-premium
 * CONFIRMADO (`premium === false`; el undefined de cargando/error no ve ni
 * un frame, como los banners) y con `config.rewarded.enabled` (la config
 * remota gobierna la existencia del formato: sin datos u `enabled: false`
 * ⇒ cero DOM, cero SDK, cero petición).
 *
 * Doc instalada del SDK v17 (react-native-google-mobile-ads): el API classic
 * createForAdRequest → load() → show() sigue siendo de primera clase para el
 * flujo "preload + CTA"; NO existe `onAdFailedToShow` — los fallos de carga
 * (phase 'load') y de show (phase 'show') llegan por `AdEventType.ERROR`, y
 * `show()` RECHAZA la promesa si el anuncio no está cargado o ya se está
 * mostrando: el `.catch` es obligatorio.
 */

/** Reward del SDK (RewardedAdReward no se reexporta del índice del paquete). */
interface RewardedReward {
  type: string;
  amount: number;
}

/**
 * Unit id con ACCESO ESTÁTICO dot-notation — mismo bug que el fix b125fc5 de
 * AdBanner: babel-preset-expo solo inlinea `EXPO_PUBLIC_*` con dot notation;
 * un mapping dinámico de claves quedaría undefined en production (env vacía
 * en runtime) → rewarded muerto, invisible en __DEV__ (TestIds sale antes).
 */
function resolveRewardedUnitId(): string {
  if (__DEV__) return TestIds.REWARDED;
  return process.env.EXPO_PUBLIC_ADMOB_REWARDED ?? '';
}

export function RewardedCard() {
  const { t } = useLocale();
  const { premium } = usePremiumStatus();
  const { data: config } = useAdsConfig();

  const rewardedEnabled = config?.rewarded.enabled === true;
  const adfreeMinutes = config?.rewarded.adfreeMinutes ?? 30;
  const adfreeMinutesRef = useRef(adfreeMinutes);
  useEffect(() => {
    adfreeMinutesRef.current = adfreeMinutes;
  }, [adfreeMinutes]);

  const adRef = useRef<RewardedAd | null>(null);
  const [ready, setReady] = useState(false); // anuncio cargado y mostrable
  const [showing, setShowing] = useState(false);
  // Éxito TRANSITORIO, no estado terminal: se muestra desde la concesión
  // hasta que el siguiente anuncio (CLOSED ya lo recarga) llega a LOADED —
  // el CTA debe poder volver a usarse para acumular más minutos.
  const [successFlash, setSuccessFlash] = useState(false);
  const [error, setError] = useState(false);
  // Guard contra doble-tap del reintento (solo la vía con instancia; la vía
  // de consentimiento se protege sola: el re-run del efecto cancela el
  // anterior con `cancelled`).
  const [retrying, setRetrying] = useState(false);
  // Reintento SIN instancia (fallo de consentimiento): bump ⇒ el efecto
  // reabre el flujo completo (UMP + create + load).
  const [consentRetry, setConsentRetry] = useState(0);

  // Concesión vía la función PURA grantAdfreeReward (regla de dinero,
  // testeada): mismatch de type/amount con lo configurado ⇒ NO se concede.
  // Los minutos se leen del REF: el listener de EARNED_REWARD vive fuera del
  // ciclo de render y la config puede refrescar con la instancia cargada.
  const handleEarned = useCallback(async (reward: RewardedReward) => {
    const minutes = adfreeMinutesRef.current;
    const until = grantAdfreeReward(reward, minutes, await getAdfreeUntil(), Date.now());
    if (until === null) {
      console.warn(
        '[ads] reward inesperado — adfree NO concedido',
        reward,
        { esperado: { type: REWARD_TYPE, amount: minutes } },
      );
      capture('ads_rewarded_failed', { reason: 'reward_mismatch' });
      return;
    }
    try {
      await setAdfreeUntil(until);
      setSuccessFlash(true);
      capture('ads_rewarded_completed', { minutes });
    } catch (err) {
      // El usuario vio el anuncio y el premio no se pudo persistir: explícito
      // en pantalla y consola (nunca silencio).
      console.warn('[ads] no se pudo persistir el adfree', err);
      capture('ads_rewarded_failed', { reason: 'storage_failed' });
      setError(true);
    }
  }, []);

  // Ciclo del anuncio: SOLO con gating en verde se toca el SDK (consentimiento
  // e init comparten los MISMOS singletons que los banners — gatherConsent
  // repetido podría reabrir el formulario UMP).
  useEffect(() => {
    if (premium !== false || !rewardedEnabled) return;
    const unitId = resolveRewardedUnitId();
    if (!unitId) {
      // Fail-closed como los banners: env vacía en production ⇒ sin rewarded.
      // No es transitorio (config de build), así que sin estado de reintento.
      console.warn('[ads] rewarded sin unit id configurado (EXPO_PUBLIC_ADMOB_REWARDED)');
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const consent = await ensureAdsConsent();
        if (!consent.canRequestAds) {
          if (!cancelled) setError(true);
          return;
        }
        await ensureSdkInitialized();
        if (cancelled) return;
        const ad = RewardedAd.createForAdRequest(unitId, {
          // Sin consentimiento confirmado NO se llega aquí (fail-closed
          // arriba); con él, manda el UMP (paridad con los banners, que no
          // fuerzan la bandera). Cinturón: si el gating se relajara algún
          // día, el valor cae en NPA (conservador, nunca lo contrario).
          requestNonPersonalizedAdsOnly: !consent.canRequestAds,
        });
        ad.addAdEventListener(RewardedAdEventType.LOADED, () => {
          if (cancelled) return;
          setReady(true);
          setError(false);
          setRetrying(false);
          // El flash de éxito muere aquí: el nuevo anuncio está listo y el
          // CTA vuelve a estar habilitado (acumulable).
          setSuccessFlash(false);
        });
        ad.addAdEventListener(AdEventType.ERROR, (err) => {
          if (cancelled) return;
          // v17: fallos de carga (phase 'load') y de show (phase 'show')
          // llegan por aquí — log explícito + estado visible + analítica.
          console.warn(
            '[ads] rewarded error',
            err.phase ?? 'load',
            err.reason ?? err.code,
            err.message,
          );
          capture('ads_rewarded_failed', {
            reason: err.phase === 'show' ? 'show_failed' : 'load_failed',
          });
          setError(true);
          setReady(false);
          setRetrying(false);
          setSuccessFlash(false);
        });
        ad.addAdEventListener(AdEventType.CLOSED, () => {
          if (cancelled) return;
          // Anuncio gastado: recarga para poder ganar más minutos (el reward
          // es acumulable). El flash de éxito PERSISTE durante la recarga —
          // solo muere en LOADED o ERROR. Un fallo de recarga lo cantará
          // ERROR (phase load), que deja el bloque de reintento.
          setReady(false);
          ad.load();
        });
        ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, (reward) => {
          if (!cancelled) void handleEarned(reward as RewardedReward);
        });
        adRef.current = ad;
        ad.load();
      } catch (err) {
        // Consentimiento/init fallidos ya se loguearon en sus singletons;
        // aquí solo queda el estado visible (bloque de reintento).
        if (!cancelled) setError(true);
        console.warn('[ads] rewarded no disponible en esta sesión', err);
      }
    })();
    return () => {
      cancelled = true;
      adRef.current?.removeAllListeners();
      adRef.current?.destroy();
      adRef.current = null;
    };
  }, [premium, rewardedEnabled, handleEarned, consentRetry]);

  const handleShow = useCallback(() => {
    const ad = adRef.current;
    if (!ad) return;
    setShowing(true);
    // Doc v17: show() RECHAZA la promesa si el anuncio no está cargado, ya se
    // está mostrando o la plataforma declina — SIEMPRE .catch (visible).
    ad.show()
      .then(() => {
        setError(false);
      })
      .catch((err: unknown) => {
        console.warn('[ads] rewarded show rechazado', err);
        capture('ads_rewarded_failed', { reason: 'show_rejected' });
        setError(true);
      })
      .finally(() => {
        setShowing(false);
      });
  }, []);

  /**
   * Reintento del bloque de error (el error debe tener SALIDA, no un "en unos
   * segundos" que nunca llega): con instancia ⇒ `load()` directo (guard
   * doble-tap); sin instancia (consentimiento fallido) ⇒ resetea el singleton
   * de consentimiento (un fail-closed cacheado sería irrecuperable) y reabre
   * el flujo completo re-montando el ciclo vía `consentRetry`.
   */
  const handleRetry = useCallback(() => {
    const ad = adRef.current;
    if (!ad) {
      resetAdsConsent();
      setConsentRetry((n) => n + 1);
      return;
    }
    if (retrying) return;
    setRetrying(true);
    ad.load();
  }, [retrying]);

  // Fail-closed total: sin gating en verde, cero DOM (como AdBanner).
  if (premium !== false || !rewardedEnabled) return null;

  const ctaLabel = t('ads.rewarded_cta').replace('{n}', String(adfreeMinutes));

  return (
    <View className="mx-4 mt-3 rounded-xl bg-white p-4 dark:bg-slate-900">
      <Text className="text-base font-semibold text-slate-900 dark:text-slate-100">
        {ctaLabel}
      </Text>
      <Text className="mt-0.5 text-sm text-slate-500">
        {t('ads.rewarded_desc').replace('{n}', String(adfreeMinutes))}
      </Text>
      <Pressable
        onPress={handleShow}
        disabled={!ready || showing}
        accessibilityRole="button"
        className="mt-4 min-h-[44px] justify-center rounded-lg bg-rink-passion px-4 active:opacity-80 disabled:opacity-50"
      >
        <Text className="text-center font-semibold text-white">{ctaLabel}</Text>
      </Pressable>
      {successFlash ? (
        <Text
          className="mt-2 text-sm text-emerald-600 dark:text-emerald-400"
          accessibilityLiveRegion="polite"
        >
          {t('ads.rewarded_done').replace('{n}', String(adfreeMinutes))}
        </Text>
      ) : null}
      {error ? (
        // Estado de error TAPPABLE: pulsar relanza la carga (o el flujo de
        // consentimiento). Mientras el reintento vuela, la copy honesta es el
        // motivo ("no se pudo cargar"); en reposo, la acción ("toca para
        // reintentar").
        <Pressable
          onPress={handleRetry}
          disabled={retrying}
          accessibilityRole="button"
          accessibilityLiveRegion="polite"
          className="mt-2 min-h-[44px] justify-center rounded-lg border border-red-300 px-4 active:opacity-70 disabled:opacity-60 dark:border-red-900"
        >
          <Text className="text-center text-sm font-semibold text-red-600 dark:text-red-400">
            {retrying
              ? t('ads.rewarded_error')
              : t('ads.rewarded_retry')}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

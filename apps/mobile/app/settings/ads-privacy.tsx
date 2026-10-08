import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { resetAdsConsent } from '@/src/components/ads/AdBanner';
import { usePremiumStatus } from '@/src/hooks/usePremiumStatus';
import { useLocale } from '@/src/i18n/LocaleContext';
import { manageAdsConsent, type AdsConsentState } from '@/src/lib/ads/consent';

/**
 * "Publicidad y privacidad" (Plan D Task 3 — cierra la checklist
 * pre-tráfico de la política de Google): punto de entrada en Ajustes para
 * que el usuario VUELVA a gestionar su consentimiento UMP.
 *
 * El flujo lo orquesta `manageAdsConsent()` (src/lib/ads/consent.ts):
 * re-ejecuta gatherConsent — el flujo UMP REAL, no la promesa cacheada de
 * AdBanner — y, si Google exige un punto de gestión de opciones de
 * privacidad (EEA/UK), abre el formulario de opciones, que es donde el
 * usuario cambia su elección. Con la decisión nueva se llama a
 * `resetAdsConsent()` para que el PRÓXIMO banner/rewarded que monte
 * re-ejecute su singleton de consentimiento con la elección actualizada
 * (los ya montados no reviven hasta el próximo arranque: misma limitación
 * que el resto de superficies de ads).
 *
 * Esta pantalla NO toca `mobileAds().initialize()`: el UMP va ANTES de la
 * init por diseño (en init pueden precargarse ads) y el formulario no la
 * necesita. Sin sesiones ni servidores: todo client-side con el SDK.
 *
 * Estados: idle → managing → done | error (el error es TAPPABLE, patrón
 * RewardedCard). Funciona igual para premium (puede gestionar consentimiento
 * aunque no vea anuncios — nota visible en pantalla).
 */

type Phase = 'idle' | 'managing' | 'done' | 'error';

export default function AdsPrivacyScreen() {
  const { t } = useLocale();
  const { premium } = usePremiumStatus();
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<AdsConsentState | null>(null);

  const handleManage = useCallback(() => {
    // Guard doble-tap: el botón ya se deshabilita en 'managing', pero un tap
    // en el bloque de error mientras vuela el reintento no debe re-entrar.
    if (phase === 'managing') return;
    setPhase('managing');
    void manageAdsConsent()
      .then((state) => {
        // La decisión cacheada de los banners quedó obsoleta: descartarla
        // para que el próximo ensureAdsConsent re-ejecute el flujo (sin
        // formulario una vez asentado) y refleje la elección nueva.
        resetAdsConsent();
        setResult(state);
        setPhase('done');
      })
      .catch((err: unknown) => {
        // Nunca silencio (regla del repo): visible en pantalla + consola.
        console.warn('[ads] no se pudo gestionar el consentimiento', err);
        setPhase('error');
      });
  }, [phase]);

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 24 }} className="flex-1 bg-rink-floor dark:bg-rink-floor-dark">
      <View className="mx-4 mt-3 rounded-xl bg-white p-4 dark:bg-slate-900">
        <Text className="text-sm text-slate-500">{t('ads.privacy_desc')}</Text>

        {premium === true ? (
          // Premium confirmado: la pantalla sigue siendo útil (el
          // consentimiento se gestiona aunque no se sirvan anuncios).
          <Text className="mt-3 text-sm text-slate-500">{t('ads.privacy_premium_note')}</Text>
        ) : null}

        <Pressable
          onPress={handleManage}
          disabled={phase === 'managing'}
          accessibilityRole="button"
          className="mt-4 min-h-[44px] justify-center rounded-lg bg-rink-passion px-4 active:opacity-80 disabled:opacity-50"
        >
          <Text className="text-center font-semibold text-white">{t('ads.privacy_manage_cta')}</Text>
        </Pressable>

        {phase === 'managing' ? (
          <Text className="mt-2 text-sm text-slate-500" accessibilityLiveRegion="polite">
            {t('ads.privacy_managing')}
          </Text>
        ) : null}

        {phase === 'done' && result ? (
          result.canRequestAds ? (
            <Text
              className="mt-2 text-sm text-emerald-600 dark:text-emerald-400"
              accessibilityLiveRegion="polite"
            >
              {t('ads.privacy_result_ok')}
            </Text>
          ) : (
            <Text className="mt-2 text-sm text-slate-500" accessibilityLiveRegion="polite">
              {t('ads.privacy_result_ko')}
            </Text>
          )
        ) : null}

        {phase === 'error' ? (
          // Estado de error TAPPABLE (patrón RewardedCard): el error debe
          // tener SALIDA, no un "en unos segundos" que nunca llega.
          <Pressable
            onPress={handleManage}
            accessibilityRole="button"
            accessibilityLiveRegion="polite"
            className="mt-2 min-h-[44px] justify-center rounded-lg border border-red-300 px-4 active:opacity-70 dark:border-red-900"
          >
            <Text className="text-center text-sm font-semibold text-red-600 dark:text-red-400">
              {t('ads.privacy_error')}
            </Text>
            <Text className="mt-1 text-center text-xs text-red-600 dark:text-red-400">
              {t('ads.privacy_retry')}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </ScrollView>
  );
}

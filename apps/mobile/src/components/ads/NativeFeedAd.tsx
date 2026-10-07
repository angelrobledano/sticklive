import { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import {
  NativeAdView,
  NativeAsset,
  NativeAssetType,
  NativeMediaView,
  TestIds,
  useNativeAd,
} from 'react-native-google-mobile-ads';

import { ensureAdsConsent, ensureSdkInitialized } from './AdBanner';
import { useAdfreeUntil } from '@/src/hooks/useAdfreeUntil';
import { shouldShowAds, useAdsConfig } from '@/src/hooks/queries';
import { usePremiumStatus } from '@/src/hooks/usePremiumStatus';

/**
 * <NativeFeedAd /> — native in-feed (Plan D Task 6): un anuncio nativo con la
 * MISMA fisonomía que las tarjetas del listado (MatchCard), colocado como
 * item sintético cada `everyNItems` items por el llamador (index/standings;
 * la colocación la calcula `insertNativeAdPositions`, un solo punto v1).
 *
 * Fail-closed TOTAL antes de existir (misma disciplina que AdBanner):
 *   • `config.nativeFeed.enabled` (config remota gobierna la existencia —
 *     sin datos u `enabled: false` ⇒ cero DOM, cero UMP, cero petición).
 *   • premium !== false (el undefined de cargando/error no ve ni un frame).
 *   • Ad-free recompensado vigente ⇒ null (useAdfreeUntil: mount + foco).
 *   • Sin consentimiento UMP (o si falla su resolución) ⇒ null.
 *   • Sin unit id configurada (env vacía en build production) ⇒ null.
 *
 * Carga según la doc INSTALADA del SDK v17 (react-native-google-mobile-ads):
 * "One native ad owned by a component: useNativeAd + <NativeAdView>" — los
 * pools y multiformat hacen hard-error con unidades AdMob `ca-app-pub-…`.
 * El HOOK es dueño del ciclo de vida del NativeAd (destruye en unmount y las
 * resolviciones tardías; `NativeAd.destroy()` es idempotente), así que aquí
 * no hay destroy manual — misma consecuencia que la disciplina de AdBanner:
 * cero fugas. La petición se conduce con `adUnitId: show ? unitId : null`:
 * null = placement inexistente ⇒ status 'idle' y CERO petición (el hook solo
 * pide cuando los gates ya estaban en verde; equivalente a no montar el
 * BannerAd en AdBanner). Consentimiento UMP e init comparten los MISMOS
 * singletons de módulo que los banners (AdBanner.tsx) — repetirlos podría
 * reabrir el formulario UMP.
 *
 * Fallo de carga (`status: 'error'` o `'no-fill'`; no-fill es rutinario,
 * pero sin inventario no hay native que mostrar) ⇒ log explícito + colapso
 * permanente del item (sin hueco; el siguiente montaje reintenta una vez).
 */

/**
 * Unit id con ACCESO ESTÁTICO dot-notation — misma lección de b125fc5
 * (AdBanner): babel-preset-expo solo inlinea `EXPO_PUBLIC_*` con dot
 * notation; en `__DEV__` SIEMPRE TestIds (nunca clicar ads reales en dev).
 */
function resolveNativeFeedUnitId(): string {
  if (__DEV__) return TestIds.NATIVE;
  return process.env.EXPO_PUBLIC_ADMOB_NATIVE_FEED ?? '';
}

/** Altura fija del slot de media (anti-CLS: conocida antes de renderizar). */
const MEDIA_SLOT_HEIGHT = 140;

export function NativeFeedAd() {
  const { premium } = usePremiumStatus();
  const { data: config } = useAdsConfig();
  const adfreeUntil = useAdfreeUntil();
  const unitId = useMemo(() => resolveNativeFeedUnitId(), []);

  const nativeFeedEnabled = config?.nativeFeed.enabled === true;

  // Gate 1-2: premium y consentimiento (misma forma que AdBanner). Solo el
  // no-premium confirmado CON el formato activado arranca (o reutiliza) el
  // flujo de consentimiento: si el formato está apagado, cero actividad.
  const [consentGranted, setConsentGranted] = useState(false);
  useEffect(() => {
    if (premium !== false || !nativeFeedEnabled) return;
    let cancelled = false;
    void ensureAdsConsent().then((state) => {
      if (!cancelled) setConsentGranted(state.canRequestAds);
    });
    return () => {
      cancelled = true;
    };
  }, [premium, nativeFeedEnabled]);

  // Gate 3-4: adfree + unit id, dentro del guard puro testeado.
  const allowed = nativeFeedEnabled && shouldShowAds({ premium, consentGranted, unitId, adfreeUntil });

  // Init del SDK: solo cuando TODO permite (singleton compartido; el guard
  // `allowed` evita initialize aunque otro formato ya lo pasara).
  const [sdkReady, setSdkReady] = useState(false);
  useEffect(() => {
    if (!allowed || sdkReady) return;
    let cancelled = false;
    void ensureSdkInitialized()
      .then(() => {
        if (!cancelled) setSdkReady(true);
      })
      .catch(() => {
        // El fallo ya se logueó en el singleton; este item queda colapsado.
      });
    return () => {
      cancelled = true;
    };
  }, [allowed, sdkReady]);

  // show = gates en verde. El colapso por fallo de carga NO lleva estado:
  // status ≠ 'loaded' basta (ver effect de log abajo).
  const show = allowed && sdkReady;

  // Carga del native: el hook pide SOLO con los gates en verde (adUnitId
  // null ⇒ 'idle', cero petición) y es dueño del destroy en unmount.
  const { status, nativeAd, error } = useNativeAd({
    adUnitId: show ? unitId : null,
    autoLoad: true,
  });

  // Fallo de carga ('error' o 'no-fill'; no-fill es rutinario, pero sin
  // inventario no hay native que mostrar) ⇒ log explícito (nunca silencio).
  // El COLAPSO no necesita estado: con status ≠ 'loaded' el item no renderiza
  // nada (sin hueco) y la carga automática del hook no reintenta sola — el
  // fallo permanece hasta que los gates cambien la identidad de la petición
  // (p. ej. el adfree caduca y vuelve) o el item se remonte.
  useEffect(() => {
    if (status === 'error' || status === 'no-fill') {
      console.warn('[ads] native feed', status, error?.reason ?? error?.code, error?.message);
    }
  }, [status, error]);

  // Sin gates en verde o sin anuncio cargado: cero DOM, cero hueco.
  if (!show || status !== 'loaded' || !nativeAd) return null;

  return (
    <View accessibilityLabel="Espacio publicitario" className="mx-3 my-1 rounded-xl bg-white dark:bg-slate-900">
      <NativeAdView nativeAd={nativeAd}>
        <View className="p-3">
          {/* Etiqueta IAB/CNMC — literal "PUBLICIDAD", mismo estilo que la del
              banner (los overlays roban toques: aquí va en flujo, arriba). */}
          <Text
            accessible={false}
            className="text-[9px] font-semibold uppercase tracking-widest text-slate-300 dark:text-zinc-600"
          >
            PUBLICIDAD
          </Text>
          {/* Titular — asset registrado (clics imputables al anuncio). */}
          <NativeAsset assetType={NativeAssetType.HEADLINE}>
            <Text
              numberOfLines={2}
              className="mt-1 text-base font-semibold text-slate-900 dark:text-slate-100"
            >
              {nativeAd.headline}
            </Text>
          </NativeAsset>
          {/* Media/content view — slot de altura fija; el anuncio cubre. */}
          <View
            className="mt-2 overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800"
            style={{ height: MEDIA_SLOT_HEIGHT }}
          >
            <NativeMediaView style={{ width: '100%', height: '100%' }} resizeMode="cover" />
          </View>
          {/* Cuerpo — asset registrado. */}
          <NativeAsset assetType={NativeAssetType.BODY}>
            <Text numberOfLines={3} className="mt-2 text-xs text-slate-500">
              {nativeAd.body}
            </Text>
          </NativeAsset>
        </View>
      </NativeAdView>
    </View>
  );
}

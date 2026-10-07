import { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import mobileAds, {
  AdsConsent,
  BannerAd,
  BannerAdSize,
  TestIds,
} from 'react-native-google-mobile-ads';

import { shouldShowAds } from '@/src/hooks/queries';
import { usePremiumStatus } from '@/src/hooks/usePremiumStatus';
import { canRequestAdsAfterConsent, requestAdsConsent } from '@/src/lib/ads/consent';

/**
 * <AdBanner variant="list" | "match" />
 *
 * Banner AdMob (paridad con apps/web/src/components/shared/AdBanner.tsx):
 *   • premium (o estado desconocido) → null ANTES de tocar el SDK: cero UMP,
 *     cero initialize, cero petición (spec §7).
 *   • Sin consentimiento UMP (o si falla su resolución) → null (fail-closed).
 *   • Sin unit id configurado (env vacía en build production) → null.
 *   • Con TODO abierto: etiqueta "PUBLICIDAD" (IAB/CNMC, igual que la web),
 *     altura reservada para evitar CLS y <BannerAd> adaptativo.
 *
 * El tamaño adaptativo es `LARGE_ANCHORED_ADAPTIVE_BANNER` (doc instalada:
 * `ADAPTIVE_BANNER` no existe y `ANCHORED_ADAPTIVE_BANNER` está deprecado;
 * anchored = ancho completo del dispositivo, diseño Android-first v1).
 *
 * El consentimiento UMP y la init del SDK son SINGLETONS a nivel de módulo:
 * la doc pide gatherConsent una vez por arranque y `delayAppMeasurementInit`
 * (app.config.ts) exige initialize() explícito; con N banners montados
 * (4 pestañas + ficha) todos comparten la misma promesa, y como el efecto de
 * consentimiento solo arranca con `premium === false`, un premium no dispara
 * NINGUNA llamada de Google.
 */

export type AdBannerVariant = 'list' | 'match';

export interface AdBannerProps {
  variant: AdBannerVariant;
}

/** Env var por variante (docs/monetizacion.md §6): vacía/undefined ⇒ sin ads. */
const BANNER_UNIT_ENV_KEYS: Record<AdBannerVariant, string> = {
  list: 'EXPO_PUBLIC_ADMOB_BANNER_LIST',
  match: 'EXPO_PUBLIC_ADMOB_BANNER_MATCH',
};

/**
 * Unit id con fail-closed triple: en `__DEV__` SIEMPRE TestIds (nunca clicar
 * ads reales en dev); en production, la env de la variante; vacía ⇒ '' (el
 * guard shouldShowAds colapsa).
 */
function resolveBannerUnitId(variant: AdBannerVariant): string {
  if (__DEV__) return TestIds.BANNER;
  return process.env[BANNER_UNIT_ENV_KEYS[variant]] ?? '';
}

/** Reserva inicial de altura antes de conocer la real (anchored adaptativo). */
const RESERVED_BANNER_HEIGHT = 90;

// ── Singletons de módulo (una vez por arranque de la app) ───────────────────

let consentPromise: Promise<{ canRequestAds: boolean }> | null = null;

/**
 * Consentimiento UMP una vez por arranque. Doc del SDK (gatherConsent): si
 * falla, se DEBE intentar pedir ads con el estado de la sesión previa
 * (`getConsentInfo()`); si también falla, fail-closed. Cada degradación se
 * LOGUEA (nunca silencio). El resultado asentado (éxito o fail-closed) se
 * cachea: los siguientes banners montados reutilizan la misma promesa.
 */
function ensureAdsConsent(): Promise<{ canRequestAds: boolean }> {
  consentPromise ??= (async () => {
    try {
      return await requestAdsConsent();
    } catch (error) {
      try {
        const state = canRequestAdsAfterConsent(await AdsConsent.getConsentInfo());
        console.warn(
          '[ads] gatherConsent falló; se usa el estado de la sesión previa',
          error,
          state,
        );
        return state;
      } catch (fallbackError) {
        console.warn('[ads] sin estado de consentimiento disponible: fail-closed', fallbackError);
        return { canRequestAds: false };
      }
    }
  })();
  return consentPromise;
}

let initPromise: Promise<void> | null = null;

/**
 * Init ÚNICA del SDK — SOLO se llama cuando shouldShowAds ya dio verde
 * (delayAppMeasurementInit: la medición de Google no arranca hasta aquí, así
 * que un premium nunca llega a este código). Si falla, el rechazo queda
 * cacheado: sin ads hasta el próximo arranque (fail-closed, log explícito).
 */
function ensureSdkInitialized(): Promise<void> {
  initPromise ??= mobileAds()
    .initialize()
    .then(
      () => undefined,
      (error: unknown) => {
        console.warn('[ads] initialize falló (sin ads en esta sesión)', error);
        throw error;
      },
    );
  return initPromise;
}

// ── Gating combinado (premium ∧ consentimiento ∧ unit id ∧ init) ────────────

/**
 * Estados de los tres gates + init, en el orden de la doc: consentimiento
 * ANTES de initialize (en init pueden precargarse ads), e initialize ANTES de
 * montar el <BannerAd> que pediría un anuncio.
 */
function useAdBannerGating(variant: AdBannerVariant): {
  show: boolean;
  unitId: string;
  onFail: () => void;
} {
  const { premium } = usePremiumStatus();
  const unitId = useMemo(() => resolveBannerUnitId(variant), [variant]);

  // Gate 1-2: premium y consentimiento. El valor CRUDO de usePremiumStatus
  // (boolean | undefined) va al guard puro shouldShowAds, que hace fail-closed
  // con `undefined` (premium cargando/error no ve ni un frame de banner).
  const [consentGranted, setConsentGranted] = useState(false);
  useEffect(() => {
    // `undefined` = cargando/error con sesión y `true` = premium: en ambos
    // casos cero actividad de Google (ni UMP). Solo el no-premium confirmado
    // arranca (o reutiliza) el flujo de consentimiento.
    if (premium !== false) return;
    let cancelled = false;
    void ensureAdsConsent().then((state) => {
      if (!cancelled) setConsentGranted(state.canRequestAds);
    });
    return () => {
      cancelled = true;
    };
  }, [premium]);

  // Gate 3: unit id (dentro del guard puro testeado en Task 1).
  const allowed = shouldShowAds({ premium, consentGranted, unitId });

  // Init del SDK: solo cuando TODO permite. El guard `allowed` del effect
  // evita llamar a initialize aunque el singleton exista (p. ej. otro banner
  // ya lo pasó): si el estado vuelve a fail-closed, este banner no pide ads.
  const [sdkReady, setSdkReady] = useState(false);
  useEffect(() => {
    if (!allowed || sdkReady) return;
    let cancelled = false;
    void ensureSdkInitialized()
      .then(() => {
        if (!cancelled) setSdkReady(true);
      })
      .catch(() => {
        // El fallo ya se logueó en el singleton; este banner queda colapsado.
      });
    return () => {
      cancelled = true;
    };
  }, [allowed, sdkReady]);

  const [failed, setFailed] = useState(false);
  return { show: allowed && sdkReady && !failed, unitId, onFail: () => setFailed(true) };
}

// ── Componente ───────────────────────────────────────────────────────────────

export function AdBanner({ variant }: AdBannerProps) {
  const { show, unitId, onFail } = useAdBannerGating(variant);
  // Altura reservada ANTES de cargar (anti-CLS, paridad web) y sincronizada
  // con la real al cargar/cambiar de tamaño (la altura adaptativa no es
  // conocible pre-carga: no hay helper en el paquete). Al ir el banner al PIE
  // del contenido, el ajuste solo mueve la extensión del scroll, nada por encima.
  const [height, setHeight] = useState(RESERVED_BANNER_HEIGHT);

  // Sin gates: cero DOM, cero reserva, cero petición (igual que el `null` web).
  if (!show) return null;

  return (
    <View accessibilityLabel="Espacio publicitario" className="w-full">
      <View style={{ height }} className="w-full items-center justify-center">
        {/* Etiqueta IAB/CNMC — igual que la web: literal "PUBLICIDAD", esquina
            superior derecha, minúscula visual. pointerEvents="none" para que
            no robe toques al banner nativo que queda debajo. */}
        <View pointerEvents="none" className="absolute right-1.5 top-0.5 z-10">
          <Text
            accessible={false}
            className="text-[9px] font-semibold uppercase tracking-widest text-slate-300 dark:text-zinc-600"
          >
            PUBLICIDAD
          </Text>
        </View>
        <BannerAd
          unitId={unitId}
          size={BannerAdSize.LARGE_ANCHORED_ADAPTIVE_BANNER}
          onAdLoaded={({ height: loaded }) => {
            if (loaded > 0) setHeight(loaded);
          }}
          onSizeChange={({ height: changed }) => {
            if (changed > 0) setHeight(changed);
          }}
          onAdFailedToLoad={(error) => {
            // Log explícito del fallo (nunca silencio) + colapso del contenedor.
            // `reason` es el campo estructurado de v17 (`code` está deprecado).
            console.warn('[ads] banner failed', error.reason ?? error.code, error.message);
            onFail();
          }}
        />
      </View>
    </View>
  );
}

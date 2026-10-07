import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import { useNavigationContainerRef } from 'expo-router';
import { AdEventType, AppOpenAd, TestIds } from 'react-native-google-mobile-ads';

import { ensureAdsConsent, ensureSdkInitialized } from '@/src/components/ads/AdBanner';
import { useAdsConfig } from '@/src/hooks/queries';
import { usePremiumStatus } from '@/src/hooks/usePremiumStatus';
import { getAdfreeUntil, isAdfreeActive } from '@/src/lib/ads/adfree';
import {
  canShowFullScreen,
  getFullScreenBudget,
  registerFullScreenShow,
  setFullScreenBudget,
} from '@/src/lib/ads/fullscreen';
import {
  consumePushInteraction,
  incrementSessionCountOnce,
  readSessionCount,
} from '@/src/lib/ads/session-context';

/**
 * App Open en frío (Plan D Task 4), con el presupuesto de PANTALLA COMPLETA
 * COMPARTIDO con el interstitial (Task 5). Los 4 invariantes del plan:
 *   1. Ruta del gol: NADA si la app arrancó desde un tap de notificación
 *      (`getLastNotificationResponseAsync`, la misma respuesta que el listener
 *      de `_layout.tsx` marca) ni si hubo un tap caliente hace < 60 s.
 *   2. Presupuesto compartido: `canShowFullScreen` (máx 2/hora, 20 min entre
 *      shows) ANTES de pedir anuncio y RE-VERIFICADO en el momento del show.
 *   3. Grace period: contador de sesiones del storage (≤ 2 sesiones bloquea).
 *   4. Premium siempre gana: se espera al estado premium y solo `false`
 *      (anónimo o no-premium confirmado) continúa; adfree recompensado también
 *      bloquea (capa del mismo guard de dinero).
 *
 * Cuándo SE MUESTRA (doc instalada del SDK v17, "Cold starts and loading
 * screens": "If your app has completed loading and has sent the user to the
 * main content of your app, do not show the ad"): al llegar LOADED, SOLO si el
 * usuario sigue en la superficie inicial (no ha navegado a ninguna ruta) — el
 * "primer idle" del arranque. Si ya navegó, el anuncio se descarta SIN consumir
 * presupuesto (solo se registra un show que llegó a producirse).
 *
 * Cuándo SE DECIDE: UNA vez por arranque (ref del hook) cuando config y estado
 * premium están resueltos; sin config o con premium desconocido el efecto
 * reintenta (fail-closed mientras tanto) y en cuanto decide, cualquier cambio
 * posterior de deps no relanza el flujo (máx 1 intento por arranque).
 */

/**
 * Unit id con ACCESO ESTÁTICO dot-notation — mismo bug que el fix b125fc5
 * (AdBanner): babel-preset-expo solo inlinea `EXPO_PUBLIC_*` con dot notation;
 * un mapping dinámico de claves quedaría undefined en production (env vacía en
 * runtime) → app open muerto, invisible en __DEV__ (TestIds sale antes).
 */
function resolveAppOpenUnitId(): string {
  if (__DEV__) return TestIds.APP_OPEN;
  return process.env.EXPO_PUBLIC_ADMOB_APP_OPEN ?? '';
}

/** Mínimo estructural de un NavigationState de react-navigation (getRootState).
 * `index` es opcional porque las rutas anidadas pueden llegar como PartialState. */
interface NavStateLike {
  index?: number;
  routes: { state?: NavStateLike }[];
}

/**
 * ¿Navegó el usuario más allá de la superficie inicial? Recorre la cadena de
 * estados anidados del root container (layout raíz → Stack de la app → …):
 * basta que UN nivel tenga más de una ruta para que haya navegación en curso.
 */
function hasNavigatedBeyondInitial(state: NavStateLike | undefined | null): boolean {
  let current = state ?? undefined;
  while (current) {
    if (current.routes.length > 1) return true;
    current = current.routes[current.index ?? 0]?.state;
  }
  return false;
}

export function useAppOpenAd(): void {
  const { premium } = usePremiumStatus();
  const { data: config } = useAdsConfig();
  // Ref GLOBAL del NavigationContainer (expo-router, store-based): funciona
  // fuera del <Stack> (aquí el gate es hermano del Stack en _layout) y da el
  // estado de navegación EN EL MOMENTO DEL EVENTO (LOADED), sin suscribirse.
  const navigationRef = useNavigationContainerRef();
  const decidedRef = useRef(false);

  useEffect(() => {
    // Grace period (invariante 3): la sesión se cuenta SIEMPRE al arrancar,
    // haya o no config de ads (singleton de promesa; el flujo de decisión la
    // await-ea más abajo para no leer un valor stale).
    void incrementSessionCountOnce();

    if (decidedRef.current) return;
    // Sin config (query en vuelo o error) NO se decide: el efecto reintenta
    // cuando llegue. Con config.appOpen.enabled false la decisión ES no mostrar.
    if (!config) return;
    // Fail-closed (regla de dinero): premium desconocido (cargando/error con
    // sesión) no decide; se espera a que resuelva.
    if (premium === undefined) return;
    decidedRef.current = true; // UNA decisión por arranque

    if (!config.appOpen.enabled) return;
    if (premium !== false) return; // premium siempre gana (invariante 4)

    let cancelled = false;
    let ad: AppOpenAd | null = null;
    const finish = () => {
      ad?.removeAllListeners();
      ad?.destroy();
      ad = null;
    };

    void (async () => {
      try {
        // Invariante 1 — la ruta del gol: (a) arranque desde notificación en
        // frío y (b) tap de push caliente hace < 60 s. Ni una petición.
        const initialResponse = await Notifications.getLastNotificationResponseAsync();
        if (initialResponse) {
          console.warn('[ads] app open omitido: arranque desde notificación (ruta del gol)');
          return;
        }
        if (consumePushInteraction(Date.now())) {
          console.warn('[ads] app open omitido: interacción de push hace < 60 s');
          return;
        }

        // Invariante 4 — adfree recompensado: minutos regalados sin anuncios.
        if (isAdfreeActive(Date.now(), await getAdfreeUntil())) return;

        // Consentimiento ANTES de initialize (doc instalada del SDK: en init
        // pueden precargarse ads) — mismos singletons que banners/rewarded.
        const consent = await ensureAdsConsent();
        if (!consent.canRequestAds) return;

        // Presupuesto ANTES de pedir (ahorra la petición si ya está rojo).
        await incrementSessionCountOnce(); // asentado antes de leer el contador
        const [budget, sessionCount] = await Promise.all([
          getFullScreenBudget(),
          readSessionCount(),
        ]);
        if (
          !canShowFullScreen({
            enabled: true,
            now: Date.now(),
            ...budget,
            sessionCount,
            fromPush: false,
          })
        ) {
          return;
        }

        const unitId = resolveAppOpenUnitId();
        if (!unitId) {
          // Fail-closed como banners/rewarded: env vacía en production.
          console.warn('[ads] app open sin unit id configurado (EXPO_PUBLIC_ADMOB_APP_OPEN)');
          return;
        }

        await ensureSdkInitialized();
        if (cancelled) return;

        ad = AppOpenAd.createForAdRequest(unitId);
        ad.addAdEventListener(AdEventType.LOADED, () => {
          const currentAd = ad;
          if (cancelled || !currentAd) return;
          void (async () => {
            // Doc instalada: si la app ya envió al usuario al contenido, NO
            // mostrar (nunca interrumpir navegación en curso). Se descarta sin
            // consumir presupuesto (solo cuentan los shows que ocurrieron).
            if (hasNavigatedBeyondInitial(navigationRef.current?.getRootState())) {
              console.warn('[ads] app open listo pero el usuario ya navegó: no se muestra');
              finish();
              return;
            }
            // Re-verificación en el momento del show: el presupuesto es
            // COMPARTIDO y pudo agotarse mientras cargaba el anuncio.
            const current = await getFullScreenBudget();
            if (
              !canShowFullScreen({
                enabled: true,
                now: Date.now(),
                ...current,
                sessionCount,
                fromPush: false,
              })
            ) {
              console.warn('[ads] app open listo pero presupuesto agotado: no se muestra');
              finish();
              return;
            }
            try {
              // Doc v17: show() RECHAZA si no está cargado, ya se muestra o la
              // plataforma declina — SIEMPRE .catch, con log explícito.
              await currentAd.show();
            } catch (error) {
              console.warn('[ads] app open show rechazado', error);
              finish();
              return;
            }
            // SOLO si llegó a mostrarse: consume el presupuesto compartido y
            // persiste (best-effort; los fallos se loguean en fullscreen.ts).
            const shown = registerFullScreenShow(current, Date.now());
            await setFullScreenBudget(shown);
          })();
        });
        ad.addAdEventListener(AdEventType.ERROR, (error) => {
          if (cancelled) return;
          // v17: fallos de carga (phase 'load') y de show (phase 'show') llegan
          // por aquí — log explícito, sin reintento (máx 1 por arranque).
          console.warn(
            '[ads] app open error',
            error.phase ?? 'load',
            error.reason ?? error.code,
            error.message,
          );
        });
        ad.addAdEventListener(AdEventType.CLOSED, () => {
          if (cancelled) return;
          finish(); // anuncio gastado: máx 1 por arranque, no se recarga
        });
        ad.load();
      } catch (error) {
        // Consentimiento/init fallidos ya se loguearon en sus singletons.
        console.warn('[ads] app open no disponible en esta sesión', error);
      }
    })();

    return () => {
      cancelled = true;
      // Solo limpia si el flujo aún NO decidió (se desmonta/re-ejecuta
      // mientras esperaba config o premium): el flujo decidido se autolimpia
      // (finish en LOADED/CLOSED/ERROR) para que un cambio de deps no mate un
      // arranque de anuncio en marcha.
      if (!decidedRef.current) finish();
    };
  }, [config, premium, navigationRef]);
}

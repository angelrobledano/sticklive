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
  runFullScreenShowAttempt,
} from '@/src/lib/ads/fullscreen';
import {
  hasNavigatedBeyondInitial,
  isNonDefaultInitialSurface,
} from '@/src/lib/ads/navigation-state';
import {
  incrementSessionCountOnce,
  isPushInteractionActive,
  readSessionCount,
} from '@/src/lib/ads/session-context';

/**
 * App Open en frío (Plan D Task 4), con el presupuesto de PANTALLA COMPLETA
 * COMPARTIDO con el interstitial (Task 5). Los 4 invariantes del plan:
 *   1. Ruta del gol: NADA si la app arrancó desde un tap de notificación
 *      (`getLastNotificationResponseAsync`, la misma respuesta que el listener
 *      de `_layout.tsx` marca) ni si hubo un tap caliente hace < 60 s.
 *   2. Presupuesto compartido: `canShowFullScreen` (máx 2/hora, 20 min entre
 *      shows) ANTES de pedir anuncio y RE-VERIFICADO en el momento del show
 *      DENTRO de la cola serializada (`runFullScreenShowAttempt`: el
 *      interstitial de Task 5 es el otro escritor — sin la cola, dos intentos
 *      solapados leerían el mismo storage y romperían el cap).
 *   3. Grace period: contador de sesiones del storage (≤ 2 sesiones bloquea).
 *   4. Premium siempre gana: se espera al estado premium y solo `false`
 *      (anónimo o no-premium confirmado) continúa; adfree recompensado también
 *      bloquea (capa del mismo guard de dinero).
 *
 * Cuándo SE MUESTRA (doc instalada del SDK v17, "Cold starts and loading
 * screens": "If your app has completed loading and has sent the user to the
 * main content of your app, do not show the ad"): al llegar LOADED, SOLO si
 * (a) no hubo tap de push hace < 60 s, (b) el usuario sigue en la superficie
 * INICIAL — comparación RELATIVA al estado del root container capturado al
 * arrancar (`hasNavigatedBeyondInitial`, src/lib/ads/navigation-state.ts: los
 * tabs pre-pueblan sus rutas, una comparación absoluta daría siempre "navegó")
 * y (c) el presupuesto compartido sigue verde — el "primer idle" del arranque.
 * Si algo falla, el anuncio se descarta SIN consumir presupuesto (solo se
 * registra un show que llegó a producirse).
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

export function useAppOpenAd(): void {
  const { premium } = usePremiumStatus();
  const { data: config } = useAdsConfig();
  // Ref GLOBAL del NavigationContainer (expo-router, store-based): funciona
  // fuera del <Stack> (aquí el gate es hermano del Stack en _layout) y da el
  // estado de navegación EN EL MOMENTO DEL EVENTO (LOADED), sin suscribirse.
  const navigationRef = useNavigationContainerRef();
  const decidedRef = useRef(false);
  // Estado INICIAL del root container, capturado UNA vez en cuanto existe (el
  // gate monta con la app, antes de que el usuario pueda navegar): es la
  // referencia contra la que `hasNavigatedBeyondInitial` compara (Bug B del
  // review — los tabs PRE-POBLAN sus rutas, TabRouter.getInitialState, así que
  // sin este initial no hay "navegó" determinable). null = aún sin capturar
  // (fail-closed: no se muestra).
  const initialStateRef = useRef<unknown>(null);

  // Captura temprana: los layout effects del navigator asientan el estado
  // antes de este passive effect. Reintento de cortesía en el efecto de
  // decisión por si el container tardara.
  useEffect(() => {
    if (initialStateRef.current !== null) return;
    initialStateRef.current = navigationRef.current?.getRootState() ?? null;
  }, [navigationRef]);

  useEffect(() => {
    // Grace period (invariante 3): la sesión se cuenta SIEMPRE al arrancar,
    // haya o no config de ads (singleton de promesa; el flujo de decisión la
    // await-ea más abajo para no leer un valor stale).
    void incrementSessionCountOnce();

    // Reintento de captura del estado inicial (por si aún no existía).
    if (initialStateRef.current === null) {
      initialStateRef.current = navigationRef.current?.getRootState() ?? null;
    }

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
        if (isPushInteractionActive(Date.now())) {
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
            // mostrar (nunca interrumpir navegación en curso). La comparación
            // es RELATIVA al estado inicial capturado en el arranque (los tabs
            // pre-pueblan sus rutas) y SIN initial capturado ⇒ fail-closed. Se
            // descarta sin consumir presupuesto (solo cuentan los shows).
            //
            // Hardening (review Task 4, issue 1): un initial capturado TARDE o
            // por un deep link en frío NO es la superficie por defecto (los
            // tabs solas en el root) — la comparación relativa diría "no
            // navegó" y el app open pisaría contenido ya visible; se trata
            // como "ya navegó".
            const initial = initialStateRef.current;
            if (
              initial === null ||
              isNonDefaultInitialSurface(initial, '(tabs)') ||
              hasNavigatedBeyondInitial(navigationRef.current?.getRootState(), initial)
            ) {
              console.warn(
                initial === null
                  ? '[ads] app open descartado: sin estado inicial capturado (fail-closed)'
                  : '[ads] app open listo pero el usuario ya navegó: no se muestra',
              );
              finish();
              return;
            }
            // Decisión + show + registro DENTRO de la cola serializada del
            // presupuesto (compartido con el interstitial de Task 5): storage
            // FRESCO en la sección crítica, y el registro del show de este
            // intento ya es visible para el siguiente antes de que decida.
            const shown = await runFullScreenShowAttempt(async (budget) => {
              // Cinturón del invariante 1 EN el instante del show: un tap de
              // push durante la carga deja la ventana de 60 s activa.
              if (isPushInteractionActive(Date.now())) {
                console.warn('[ads] app open listo pero interacción de push hace < 60 s: no se muestra');
                return null;
              }
              if (
                !canShowFullScreen({
                  enabled: true,
                  now: Date.now(),
                  ...budget,
                  sessionCount,
                  fromPush: false,
                })
              ) {
                console.warn('[ads] app open listo pero presupuesto agotado: no se muestra');
                return null;
              }
              try {
                // Doc v17: show() RECHAZA si no está cargado, ya se muestra o la
                // plataforma declina — SIEMPRE .catch, con log explícito.
                await currentAd.show();
              } catch (error) {
                console.warn('[ads] app open show rechazado', error);
                return null;
              }
              // SOLO si llegó a mostrarse: consume el presupuesto compartido y
              // persiste (best-effort; los fallos se loguean en fullscreen.ts).
              return registerFullScreenShow(budget, Date.now());
            });
            if (!shown) finish(); // descartado: sin CLOSED ni ERROR que limpien
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
          // Review Task 4 (issue 2): el anuncio está muerto (load o show
          // falló) — liberar instancia y listeners; nada más llegará a
          // mostrarse y el flujo no tiene otro punto de limpieza.
          finish();
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

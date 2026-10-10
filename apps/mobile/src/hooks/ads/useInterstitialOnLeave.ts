import { useEffect, useRef } from 'react';
import { useNavigation } from 'expo-router';
import { AdEventType, InterstitialAd, TestIds } from 'react-native-google-mobile-ads';

import { ensureAdsConsent, ensureSdkInitialized } from '@/src/components/ads/AdBanner';
import { capture } from '@/src/lib/analytics';
import { useAdsConfig } from '@/src/hooks/queries';
import { usePremiumStatus } from '@/src/hooks/usePremiumStatus';
import { getAdfreeUntil, isAdfreeActive } from '@/src/lib/ads/adfree';
import {
  canShowFullScreen,
  registerFullScreenShow,
  runFullScreenShowAttempt,
} from '@/src/lib/ads/fullscreen';
import {
  incrementSessionCountOnce,
  isPushInteractionActive,
  readSessionCount,
} from '@/src/lib/ads/session-context';
import { isAdQuietTime } from '@/src/lib/time';

/**
 * Interstitial al SALIR de una ficha de partido NO en vivo (Plan D Task 5),
 * con el presupuesto de PANTALLA COMPLETA COMPARTIDO con el app open (Task 4).
 *
 * Los 4 invariantes del plan:
 *   1. Ruta del gol (doble cinturón): nada si hubo un tap de push hace < 60 s
 *      (`isPushInteractionActive`, re-chequeado DENTRO de la sección crítica
 *      del presupuesto, en el instante del show); y la regla local del
 *      formato: si el partido está EN VIVO (al conocerse su estado o al pasar
 *      a live durante la visita), NUNCA — la ficha en directo es la ruta del
 *      gol y ahí no toca pantalla completa (misma regla que el banner:
 *      `isAdQuietTime` — en juego o en la ventana de inicio, sin pintar por
 *      ello un directo que la fuente no ha dado).
 *   2. Presupuesto compartido: la decisión se toma DENTRO de la cola
 *      serializada (`runFullScreenShowAttempt`) con storage fresco, y SOLO se
 *      registra un show que llegó a producirse.
 *   3. Grace period: contador de sesiones del storage (≤ 2 sesiones bloquea).
 *   4. Premium siempre gana: preload solo con `premium === false` confirmado y
 *      RE-chequeo al salir (fail-closed con undefined); adfree recompensado
 *      también bloquea (capa del mismo guard de dinero) y TAMBIÉN gatea el
 *      preload: sin UMP, sin initialize y sin petición de inventario.
 *
 * Cuándo SE PRECARGA (doc instalada: consentimiento ANTES de initialize, e
 * initialize antes de load): al montar, UNA petición por visita, solo si los
 * gates estáticos pasan — `interstitial.enabled` en la config remota, premium
 * confirmado como false, SIN adfree recompensado activo, y estado del partido
 * conocido y NO en vivo. Sin estado conocido (query en vuelo) no se precarga:
 * cuando llega, el efecto re-evalúa (la petición es singleton por visita vía
 * adRef).
 *
 * Cuándo SE MUESTRA — DECISIÓN beforeRemove vs cleanup de unmount: el hook
 * escucha `beforeRemove` de expo-router (pop/replace/reset = el usuario sale
 * de la ficha). Razones: (a) es el momento exacto de la "transición natural"
 * que la doc del formato pide para los interstitials — el anuncio pre-cargado
 * cubre la transición sin esperar a que el unmount llegue tras la animación;
 * (b) el cleanup del efecto correría en CADA cambio de deps (status del
 * partido en vivo, etc.), no solo al salir — ambigüedad que beforeRemove no
 * tiene. La doc instalada del SDK NO desaconseja mostrar durante la
 * navegación: el único contrato es el de `show()` (rechaza si no cargado, en
 * vuelo o declive de plataforma — SIEMPRE con catch) y el anuncio se presenta
 * en la capa nativa, sobre la transición en curso. Sin beforeRemove (app
 * cerrada, pestañas — la ficha sigue montada al desenfocarse) no hay show: el
 * teardown sin evento de navegación NO muestra, pero SÍ libera el anuncio
 * precargado (cleanup unmount-only con flag de show en vuelo, review Task 5).
 *
 * Errores: log explícito en cada rama (nunca silencio) y NUNCA interrumpen la
 * salida del usuario: todo el flujo es fire-and-forget sin UI propia.
 */

/**
 * Unit id con ACCESO ESTÁTICO dot-notation — mismo bug que el fix b125fc5
 * (AdBanner): babel-preset-expo solo inlinea `EXPO_PUBLIC_*` con dot notation;
 * un mapping dinámico de claves quedaría undefined en production (env vacía
 * en runtime) → interstitial muerto, invisible en __DEV__ (TestIds sale antes).
 */
function resolveInterstitialUnitId(): string {
  if (__DEV__) return TestIds.INTERSTITIAL;
  return process.env.EXPO_PUBLIC_ADMOB_INTERSTITIAL ?? '';
}

export function useInterstitialOnLeave(
  // string (no MatchStatus): el DTO del DETALLE trae el estado como string
  // (types.ts) — el mismo tipo que pide isAdQuietTime.
  matchStatus: string | undefined,
  scheduledAt: string | null | undefined,
): void {
  const { premium } = usePremiumStatus();
  const { data: config } = useAdsConfig();
  const navigation = useNavigation();

  // ── Elegibilidad local (regla "no en vivo") ──────────────────────────────────
  // null = estado del partido aún desconocido (fail-closed: sin interstitial).
  // true = el PRIMER estado conocido NO era en vivo. false = se vio en vivo
  // (al conocerse o al pasar a live durante la visita): bloqueado para siempre.
  const eligibleRef = useRef<boolean | null>(
    matchStatus === undefined ? null : !isAdQuietTime(matchStatus, scheduledAt),
  );

  useEffect(() => {
    if (matchStatus === undefined) return; // aún sin dato: nada que capturar
    if (isAdQuietTime(matchStatus, scheduledAt)) {
      eligibleRef.current = false; // en vivo al montar o al pasar a live: NUNCA
      return;
    }
    if (eligibleRef.current === null) eligibleRef.current = true; // primera captura
  }, [matchStatus, scheduledAt]);

  // Anuncio precargado (UNO por visita): null = nada precargado — su existencia
  // ES el gate de config (`interstitial.enabled` se aplicó al preload; sin
  // anuncio no hay show, así que la salida ni consulta la config).
  const adRef = useRef<InterstitialAd | null>(null);

  // true mientras el flujo de salida (beforeRemove) tiene un intento de show
  // EN VUELO: el cleanup de unmount no debe liberar el anuncio entonces (el
  // show en curso es dueño de su propia limpieza: release si no se mostró,
  // CLOSED/ERROR si se mostró). Review Task 5 (fuga nativa).
  const showInFlightRef = useRef(false);

  // Estado premium del render actual para re-chequearlo al salir (invariante 4:
  // el preload pudo ocurrir como anónimo y el estado pudo cambiar en la visita).
  const premiumRef = useRef(premium);
  useEffect(() => {
    premiumRef.current = premium;
  }, [premium]);

  // ── Preload (gates estáticos; consentimiento antes de initialize, doc) ──────
  useEffect(() => {
    if (adRef.current) return; // ya hay petición en curso: UNA por visita
    if (premium !== false) return; // premium gana; undefined (cargando) fail-closed
    if (!config?.interstitial.enabled) return; // la config gobierna la EXISTENCIA
    // Gate "no en vivo" del preload: solo con estado CONOCIDO y no-live. Con
    // estado desconocido se espera (el efecto re-evalúa al llegar el dato).
    if (matchStatus === undefined || isAdQuietTime(matchStatus, scheduledAt)) {
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        // Invariante 4 — adfree recompensado (review Task 5) ANTES de tocar el
        // SDK: sin UMP, sin initialize y sin petición de inventario — mismo
        // orden que el app open (Task 4).
        if (isAdfreeActive(Date.now(), await getAdfreeUntil())) return;
        const consent = await ensureAdsConsent();
        if (!consent.canRequestAds || cancelled || adRef.current) return;
        await ensureSdkInitialized();
        if (cancelled || adRef.current) return;
        const unitId = resolveInterstitialUnitId();
        if (!unitId) {
          // Fail-closed como banners/rewarded: env vacía en production.
          console.warn(
            '[ads] interstitial sin unit id configurado (EXPO_PUBLIC_ADMOB_INTERSTITIAL)',
          );
          return;
        }
        const ad = InterstitialAd.createForAdRequest(unitId);
        // Fallos (load y show, phase estructurada): log explícito y liberación —
        // un ERROR deja el anuncio muerto (v17: no hay onAdFailedToShow).
        ad.addAdEventListener(AdEventType.ERROR, (error) => {
          console.warn(
            '[ads] interstitial error',
            error.phase ?? 'load',
            error.reason ?? error.code,
            error.message,
          );
          ad.removeAllListeners();
          ad.destroy();
          if (adRef.current === ad) adRef.current = null;
        });
        // Tras el show, la instancia se gasta: liberar al cerrar (la pantalla
        // ya no existe; nadie más puede hacerlo).
        ad.addAdEventListener(AdEventType.CLOSED, () => {
          ad.removeAllListeners();
          ad.destroy();
          if (adRef.current === ad) adRef.current = null;
        });
        adRef.current = ad;
        ad.load();
      } catch (error) {
        // Consentimiento/init fallidos ya se loguearon en sus singletons.
        console.warn('[ads] interstitial de salida no disponible (preload)', error);
      }
    })();

    return () => {
      cancelled = true;
      // El anuncio NO se destruye aquí: una vez creado, es propiedad del flujo
      // de salida (beforeRemove) o de sus listeners CLOSED/ERROR. Destruir en
      // este cleanup (que también corre en cambios de deps) mataría un
      // anuncio precargado válido a mitad de visita.
    };
  }, [config, premium, matchStatus, scheduledAt]);

  // ── Show al salir (beforeRemove de expo-router; ver DECISIÓN arriba) ────────
  useEffect(() => {
    return navigation.addListener('beforeRemove', () => {
      const ad = adRef.current;
      // Liberación NULL-safe e IDEMPOTENTE (destroy() es no-op si ya está
      // destruido): TODA rama que no muestre el anuncio debe liberar el
      // precargado — la pantalla se va y no hay show futuro posible (review
      // Task 5: sin esto, el registro nativo del SDK acumulaba un ad vivo por
      // cada visita a ficha no-live hasta reiniciar la app).
      const release = () => {
        if (!ad) return;
        ad.removeAllListeners();
        ad.destroy();
        if (adRef.current === ad) adRef.current = null;
      };
      // Gates baratos PRIMERO (sin storage ni SDK): el show nunca retrasa una
      // salida que de todos modos no mostraría nada.
      if (eligibleRef.current !== true) {
        release();
        return;
      }
      // Re-chequeo con el RELOJ de la salida: un 'scheduled' cuyo saque pasó
      // durante la visita entra en la ventana sin anuncios (isAdQuietTime)
      // aunque las props no cambiaran (y con estado desconocido, eligibleRef
      // sería null).
      if (matchStatus === undefined || isAdQuietTime(matchStatus, scheduledAt)) {
        release();
        return;
      }
      if (premiumRef.current !== false) {
        release(); // invariante 4 (fail-closed)
        return;
      }
      if (!ad || !ad.loaded) {
        release(); // sin precarga o sin fill: nada que mostrar
        return;
      }

      showInFlightRef.current = true;
      void (async () => {
        try {
          // Invariante 4 — adfree recompensado: minutos regalados sin anuncios.
          if (isAdfreeActive(Date.now(), await getAdfreeUntil())) {
            release();
            return;
          }
          // Grace period: sesión asentada antes de leer el contador.
          await incrementSessionCountOnce();
          const sessionCount = await readSessionCount();
          const shown = await runFullScreenShowAttempt(async (budget) => {
            // Ruta del gol EN el instante del show: la ventana de 60 s pudo
            // abrirse con el propio tap de salida (notificación en la bandeja).
            if (isPushInteractionActive(Date.now())) {
              console.warn('[ads] interstitial omitido: interacción de push hace < 60 s');
              return null;
            }
            // Presupuesto COMPARTIDO decidido con storage FRESCO dentro de la
            // sección crítica (enabled:true es honesto: sin preload no hay
            // show — la config se aplicó al precargar).
            if (
              !canShowFullScreen({
                enabled: true,
                now: Date.now(),
                ...budget,
                sessionCount,
                fromPush: false,
              })
            ) {
              console.warn('[ads] interstitial omitido: presupuesto agotado');
              return null;
            }
            try {
              // Doc v17: show() RECHAZA si no está cargado, ya se muestra o la
              // plataforma declina — SIEMPRE catch, con log explícito.
              await ad.show();
            } catch (error) {
              console.warn('[ads] interstitial show rechazado', error);
              return null;
            }
            // SOLO si llegó a mostrarse: consume el presupuesto compartido.
            return registerFullScreenShow(budget, Date.now());
          });
          if (shown) capture('ads_interstitial_shown'); // show confirmado (Task 7)
          if (!shown) release(); // descartado: no habrá CLOSED/ERROR que limpien
          // shown=true: el listener de CLOSED (preload) libera la instancia.
        } catch (error) {
          console.warn('[ads] interstitial al salir no disponible', error);
          release();
        } finally {
          showInFlightRef.current = false;
        }
      })();
    });
  }, [navigation, matchStatus, scheduledAt]);

  // ── Teardown SIN beforeRemove (review Task 5) ────────────────────────────────
  // Si la pantalla se desmonta sin evento de navegación (reset del root, hot
  // reload), el precargado se libera AQUÍ — excepto con un show en vuelo (su
  // dueño es el propio flujo: release si no se mostró, CLOSED/ERROR si se
  // mostró). deps [] = SOLO unmount: los cambios de deps a mitad de visita no
  // tocan el anuncio (lo gobierna beforeRemove).
  useEffect(
    () => () => {
      if (showInFlightRef.current) return;
      const ad = adRef.current;
      if (!ad) return;
      ad.removeAllListeners();
      ad.destroy();
      adRef.current = null;
    },
    [],
  );
}

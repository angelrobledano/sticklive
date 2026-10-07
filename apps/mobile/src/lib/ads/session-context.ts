import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Contexto de sesión para el gating full-screen (Plan D Task 4):
 *
 * 1. Marca de interacción de push (la "ruta del gol", invariante 1): el punto
 *    de captura de taps de notificación de `app/_layout.tsx` (el
 *    `getLastNotificationResponseAsync` de arranque en frío y el listener de
 *    respuestas) marca el tap; `isPushInteractionActive` responde true durante
 *    los 60 s siguientes y el presupuesto full-screen se considera rojo. Va en
 *    MEMORIA (60 s no deben sobrevivir un reinicio) y NO se consume al leer:
 *    la ventana ES el límite, y varios gates (app open + interstitial) pueden
 *    consultarla legítimamente dentro de ella.
 *
 * 2. Contador de sesiones (grace period, invariante 3): se incrementa 1× por
 *    arranque en frío (el módulo JS solo se recarga aquí), en
 *    `ads.session_count`. Parseo defensivo: basura ⇒ 0 — para el grace period
 *    0 cuenta como "usuario nuevo" ⇒ fail-closed (sin full-screen).
 */

/** Ventana tras un tap de push en la que no existe full-screen. */
const PUSH_WINDOW_MS = 60_000;

/** Clave del contador de sesiones en AsyncStorage (string-only). */
const SESSION_COUNT_KEY = 'ads.session_count';

let lastPushInteractionAt: number | null = null;

/**
 * Marca el tap de una notificación (lo llama el punto de captura de
 * `app/_layout.tsx` en el instante del tap).
 */
export function markPushInteraction(now: number = Date.now()): void {
  lastPushInteractionAt = now;
}

/**
 * true si hubo un tap de push hace < 60 s (invariante 1: ni app open ni
 * interstitial — el gol puede llegar por esa ruta). Lectura PURA de la marca:
 * no la borra, la ventana limita su vigencia. (Rename del review Task 4: no
 * consume nada — el nombre anterior lo sugería y es falso.)
 */
export function isPushInteractionActive(now: number = Date.now()): boolean {
  return lastPushInteractionAt !== null && now - lastPushInteractionAt < PUSH_WINDOW_MS;
}

/**
 * Lee el contador de sesiones. Parseo DEFENSIVO: cualquier basura (no
 * numérico, no entero, negativo, NaN, Infinity) ⇒ 0. Nunca lanza: el fallo de
 * storage solo puede costar que el grace period dure más (fail-closed en la
 * dirección correcta), nunca romper el arranque.
 */
export async function readSessionCount(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(SESSION_COUNT_KEY);
    if (raw === null) return 0;
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
  } catch (error) {
    console.warn('[ads] no se pudo leer session_count', error);
    return 0;
  }
}

let sessionCountPromise: Promise<void> | null = null;

/**
 * Incrementa el contador de sesiones UNA vez por arranque en frío. Patrón
 * singleton de promesa del repo (ensureAdsConsent / ensureSdkInitialized):
 * llamar N veces cuenta 1, y el llamador puede await-earla ANTES de
 * `readSessionCount` para no ver un valor stale. Los errores se loguean y se
 * asientan (el grace period con contador a 0 es fail-closed para ads).
 */
export function incrementSessionCountOnce(): Promise<void> {
  sessionCountPromise ??= (async () => {
    try {
      const current = await readSessionCount();
      await AsyncStorage.setItem(SESSION_COUNT_KEY, String(current + 1));
    } catch (error) {
      console.warn('[ads] no se pudo incrementar session_count', error);
    }
  })();
  return sessionCountPromise;
}

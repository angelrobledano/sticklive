import { PostHog } from 'posthog-react-native';
import { getDeviceId } from '@/src/lib/device';
import { loadSession } from '@/src/lib/session';
import type { FavoriteKind } from '@/src/hooks/favorites';

/**
 * Analítica de producto de la app móvil (Task 5.1) — PostHog EU con autocapture
 * APAGADO (spec §7): la app solo emite los eventos tipados de este fichero,
 * nunca nada automático. Ni toques ni pantallas (prop `autocapture={false}` del
 * provider en `_layout.tsx`), ni ciclo de vida (`captureAppLifecycleEvents:
 * false`), ni excepciones (`errorTracking.autocapture: false` — el canal de
 * errores es Sentry, no PostHog).
 *
 * Identidad (paridad con la web, docs/TRACKING_POSTHOG.md §2 y #239): la
 * persona anónima es el `deviceId` de `src/lib/device` — el MISMO identificador
 * que viaja al API y que usan los eventos de servidor (`notification_sent` del
 * ETL usa device_id como distinctId), así que cliente y servidor caen en la
 * misma persona sin joins. Al iniciar sesión, `identifyUser(email)` fusiona la
 * persona del dispositivo con la de la cuenta (el SDK envía $identify con el
 * id previo como $anon_distinct_id, verificado en @posthog/core). Al CERRAR
 * sesión, `resetIdentity()` mata el email persistido en el SDK para que un
 * login posterior con otra cuenta nunca fusione su persona con la anterior.
 *
 * Regla del "UN punto de llamada": ningún módulo importa posthog-react-native
 * directamente; todo pasa por `capture`/`identifyUser` de aquí.
 *
 * Sin key (`EXPO_PUBLIC_POSTHOG_KEY` vacío — típico en desarrollo) TODO es
 * no-op documentado: no se crea cliente, no hay red, y ningún capture rompe.
 * Verificar eventos REALES en PostHog queda pendiente de un humano con key
 * (plan Task 5.1 Step 3).
 */

const POSTHOG_KEY = process.env['EXPO_PUBLIC_POSTHOG_KEY'] ?? '';
const POSTHOG_HOST = process.env['EXPO_PUBLIC_POSTHOG_HOST'] || 'https://eu.i.posthog.com';

/** Catálogo de eventos de la app (plan Task 5.1). Nombres/props de
 *  docs/TRACKING_POSTHOG.md donde aplica: `notification_opened` usa
 *  `notification_type` — la MISMA propiedad que `notification_sent` del
 *  servidor y el SW web — para que el CTR por tipo agrupe ambas plataformas. */
export interface AnalyticsEventProps {
  match_opened: { match_id: string };
  live_tab_viewed: Record<string, never>;
  favorite_added: { kind: FavoriteKind };
  favorite_removed: { kind: FavoriteKind };
  login_completed: { method: 'google' };
  push_registered: Record<string, never>;
  push_failed: { reason?: string };
  notification_opened: { notification_type: string };
  // Monetización (Task 2): funnel premium de la app — vista de la pantalla y
  // salida a la web a comprar (paridad de nombres con los eventos del servidor).
  premium_viewed: Record<string, never>;
  premium_web_checkout_started: Record<string, never>;
}

let client: PostHog | null = null;
let identitySeeded = false;

/** Cliente único de PostHog, compartido con el PostHogProvider del root.
 *  null = sin key: la analítica está apagada y nada se envía ni se rompe. */
export function getPostHogClient(): PostHog | null {
  if (!POSTHOG_KEY) return null;
  if (!client) {
    client = new PostHog(POSTHOG_KEY, {
      host: POSTHOG_HOST,
      // Nada automático (ver cabecera): ni eventos de ciclo de vida…
      captureAppLifecycleEvents: false,
      // …ni excepciones (canal de errores: Sentry).
      errorTracking: { autocapture: false },
    });
    seedDeviceIdentity(client);
  }
  return client;
}

/**
 * Siembra la identidad UNA vez por proceso, en cuanto el SDK está listo:
 *  · Con sesión persistida NO se toca nada: el distinct del SDK ya es el email
 *    del login (lo puso identifyUser en signInWithGoogle) y re-identificar el
 *    deviceId voltearía la identidad de la sesión (y reabriría el camino de
 *    fusión entre cuentas que resetIdentity cierra).
 *  · Sin sesión, la persona anónima pasa a ser el deviceId — salvo que el SDK
 *    ya traiga ese mismo deviceId de una sesión anterior (entonces un identify
 *    de más solo emitiría un $identify innecesario).
 */
function seedDeviceIdentity(ph: PostHog): void {
  if (identitySeeded) return;
  identitySeeded = true;
  void Promise.all([getDeviceId(), loadSession()])
    .then(([deviceId, session]) => {
      if (!session?.email && ph.getDistinctId() !== deviceId) ph.identify(deviceId);
    })
    .catch((err) => {
      // Sin deviceId los eventos salen con el uuid del SDK y quedan fusionados
      // con la cuenta al hacer login. Nunca silencioso, nunca fatal.
      console.warn('[analytics] no se pudo resolver la identidad del dispositivo', err);
    });
}

/** Vincula la persona del dispositivo con la cuenta (al canjear el login).
 *  Síncrono a propósito: el SDK encola, y llamarlo ANTES del capture de
 *  `login_completed` garantiza el orden. Sin email no hay identify: la persona
 *  sigue siendo el deviceId (el canje puede devolver email null). */
export function identifyUser(email: string): void {
  const ph = getPostHogClient();
  if (!ph) return;
  try {
    ph.identify(email);
  } catch (err) {
    console.warn('[analytics] no se pudo identificar al usuario', err);
  }
}

/**
 * Al cerrar sesión: borra la identidad del SDK (el distinct/email persistido
 * incluido). Sin esto, un login posterior con OTRA cuenta en la misma sesión
 * enviaría $identify con el email anterior como $anon_distinct_id y PostHog
 * FUSIONARÍA la persona A con la B. El seed del próximo arranque (sin sesión)
 * deja la identidad otra vez en el deviceId. Nunca lanza.
 */
export function resetIdentity(): void {
  const ph = getPostHogClient();
  if (!ph) return;
  try {
    ph.reset();
  } catch (err) {
    console.warn('[analytics] no se pudo resetear la identidad', err);
  }
}

/**
 * Captura un evento del catálogo. Fire-and-forget con try/catch interno: la
 * analítica NUNCA rompe la app (fallo → warn en consola). Sin key es no-op.
 */
export function capture<E extends keyof AnalyticsEventProps>(
  event: E,
  props?: AnalyticsEventProps[E],
): void {
  try {
    const ph = getPostHogClient();
    if (!ph) return; // sin key: no-op (ver cabecera)
    ph.capture(event, props);
  } catch (err) {
    console.warn(`[analytics] no se pudo capturar "${String(event)}"`, err);
  }
}

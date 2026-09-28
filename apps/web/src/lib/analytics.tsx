'use client';

/**
 * Analítica de producto (PostHog) — instrumentación explícita.
 *
 * Principios:
 *  · Consentimiento previo (RGPD/ePrivacy): PostHog NO se inicializa ni
 *    persiste nada hasta que el usuario acepta (ver `lib/consent.ts`).
 *    Sin consentimiento, `track`/`identify`/... son no-op.
 *  · Autocapture APAGADO: solo eventos con nombre e intención (plan de tracking).
 *    #340: además se apaga el grabador de sesión de PostHog (`session_recording`),
 *    las encuestas y las "dead clicks": el único grabador que queda es el de
 *    Sentry (y solo en error, ver `instrumentation-client.ts`). Se conserva el
 *    `track()` de producto intacto.
 *  · No se captura en desarrollo salvo NEXT_PUBLIC_POSTHOG_DEBUG=1.
 *  · person_profiles: 'identified_only' → los anónimos no crean perfil
 *    (ahorra coste y ruido); el perfil nace al hacer login.
 *  · Identidad alineada con el servidor (#239): el distinct_id anónimo es el
 *    `device_id` (`rink-device-id`), el mismo que usan los eventos de servidor
 *    (push, premium). Además, cada evento lleva `device_id` como property para
 *    poder unir cliente↔servidor incluso tras hacer login.
 *  · Pageviews manuales con ruta NORMALIZADA (/matches/:id, no el uuid),
 *    con locale como propiedad — agregables sin limpieza posterior.
 *  · #245: con person_profiles='identified_only' las person props de anónimos no
 *    crean perfil fiable, así que TODOS los eventos llevan dimensiones de
 *    segmentación baratas (theme, platform, pwa_installed, notifications_enabled;
 *    `locale` lo aporta cada evento/pageview). Ver `segmentationProps`.
 *
 * Plan de eventos:
 *  $pageview                 route, locale, device_id
 *  competition_view          competition_id, locale, device_id
 *  team_view                 team_id, locale, device_id
 *  player_view               player_id, locale, device_id        (#242)
 *  match_view                match_id, status (scheduled|live|finished),
 *                            previous_status (solo en transiciones)  (#241)
 *  live_match_followed       match_id, season_id, source (open|push)  (#241)
 *  live_match_dwell          match_id, seconds_watched            (#241)
 *  live_stream_status_changed match_id, status
 *                            (connecting|live|error|timeout|finished)  (#244)
 *  search_performed          surface, query_length, query_terms,
 *                            result_count, has_results            (#240)
 *  search_result_clicked     surface, kind (team|player|competition), ref_id (#240)
 *  favorite_added/removed    kind (team|league|player), ref_id,
 *                            total_favorites, preset_selected (solo al añadir) (#243)
 *  locale_changed            from, to (+person prop locale)
 *  theme_changed             dark (boolean)
 *  notification_toggle       key, enabled
 *  premium_checkout_started  —
 *  login_link_requested      —
 *  login_completed           (+identify por email)
 */

import posthog from 'posthog-js';
import { useCallback, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { entityViewFromPath, entityIdProp } from '@/lib/analytics-entity';
import { CONSENT_EVENT, CONSENT_KEY, isAnalyticsAllowed, readConsent } from '@/lib/consent';

const KEY  = process.env['NEXT_PUBLIC_POSTHOG_KEY'];
const HOST = process.env['NEXT_PUBLIC_POSTHOG_HOST'] ?? 'https://eu.i.posthog.com';
const ENABLED =
  !!KEY &&
  (process.env.NODE_ENV === 'production' || process.env['NEXT_PUBLIC_POSTHOG_DEBUG'] === '1');

/** Mismo identificador de dispositivo que usan API/ETL para los eventos de servidor. */
const DEVICE_KEY = 'rink-device-id';

/** Clave del tema (compartida con `app/[locale]/settings/config.ts`). */
const THEME_KEY = 'rink-theme';

let initialized = false;

/** Lee el `device_id` de localStorage. Sin navegador o sin clave → null. */
function readDeviceId(): string | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage.getItem(DEVICE_KEY) : null;
  } catch {
    return null;
  }
}

/**
 * Clasificación de plataforma para segmentar (#245). Misma heurística que
 * `pwaPlatform()` en `lib/pwa`; se replica aquí para no crear un ciclo de
 * imports (pwa ya importa analytics).
 */
function platformFromUA(): 'ios' | 'android' | 'desktop' {
  if (typeof navigator === 'undefined') return 'desktop';
  const ua = navigator.userAgent || '';
  if (/iphone|ipad|ipod/i.test(ua)
    || ((navigator as { platform?: string }).platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
    return 'ios';
  }
  if (/android/i.test(ua)) return 'android';
  return 'desktop';
}

/**
 * Dimensiones de segmentación baratas (#245). Con `person_profiles:
 * 'identified_only'` los anónimos no crean perfil, así que adjuntamos estas
 * props a CADA evento para no perder cohortes (tema, plataforma, PWA, avisos).
 * Best-effort: cualquier acceso bloqueado se ignora.
 */
export function segmentationProps(): Record<string, unknown> {
  if (typeof window === 'undefined') return {};
  const props: Record<string, unknown> = {};
  try {
    const stored = window.localStorage.getItem(THEME_KEY);
    props['theme'] = stored === 'dark' || stored === 'light'
      ? stored
      : (document.documentElement.classList.contains('dark') ? 'dark' : 'light');
  } catch { /* noop */ }
  try {
    const locale = window.localStorage.getItem('sticklive_locale');
    if (locale) props['locale'] = locale;
  } catch { /* noop */ }
  props['platform'] = platformFromUA();
  try {
    props['pwa_installed'] =
      !!window.matchMedia?.('(display-mode: standalone)').matches
      || (navigator as unknown as { standalone?: boolean }).standalone === true;
  } catch { /* noop */ }
  if (typeof Notification !== 'undefined') {
    try { props['notifications_enabled'] = Notification.permission === 'granted'; } catch { /* noop */ }
  }
  return props;
}

/**
 * Añade `device_id` (#239) y las dimensiones de segmentación (#245) a cada
 * evento. Las props del llamante tienen prioridad (p. ej. el `locale` de la ruta).
 */
function withDevice(props?: Record<string, unknown>): Record<string, unknown> {
  const deviceId = readDeviceId();
  return {
    ...segmentationProps(),
    ...(props ?? {}),
    ...(deviceId ? { device_id: deviceId } : {}),
  };
}

function ensureInit(): boolean {
  if (!ENABLED || typeof window === 'undefined') return false;
  // Puerta de consentimiento: nada de PostHog (ni cookies/persistencia) hasta aceptar.
  if (!isAnalyticsAllowed(readConsent())) return false;
  if (!initialized) {
    const deviceId = readDeviceId();
    posthog.init(KEY!, {
      api_host: HOST,
      capture_pageview: false,   // pageviews manuales (App Router)
      capture_pageleave: true,   // duración de sesión/página
      autocapture: false,        // solo eventos del plan
      // #340: sin grabador de sesión propio. Solo track()/pageviews; el único
      // session replay es el de Sentry (solo en error) para no duplicar costo.
      disable_session_recording: true,
      disable_surveys: true,     // no cargar surveys.js
      capture_dead_clicks: false, // no cargar dead-clicks-autocapture.js
      person_profiles: 'identified_only',
      // Identidad anónima = device_id, compartida con los eventos de servidor.
      ...(deviceId ? { bootstrap: { distinctID: deviceId } } : {}),
    });
    initialized = true;
  }
  return true;
}

/** Evento del plan de tracking. No-op sin clave, en desarrollo o sin consentimiento. */
export function track(event: string, props?: Record<string, unknown>): void {
  if (!ensureInit()) return;
  posthog.capture(event, withDevice(props));
}

/**
 * Guard de emisión única (#247). Devuelve `true` solo la primera vez que se ve
 * `key` en el almacén; los siguientes montajes/recargas de la misma sesión
 * devuelven `false`. Sin almacén disponible no deduplica (mejor contar que
 * perder el evento) y nunca lanza. Puro para poder fijarlo con tests.
 */
export function claimOnce(
  store: { getItem(key: string): string | null; setItem(key: string, value: string): void },
  key: string,
): boolean {
  try {
    if (store.getItem(key) !== null) return false;
    store.setItem(key, '1');
    return true;
  } catch {
    return true;
  }
}

/**
 * Emite un evento de página como máximo UNA vez por `key` dentro de la sesión
 * de navegador (#247). Pensado para eventos de compra que hoy se re-emitían en
 * cada montaje/recarga de `/premium/success` y `/premium/error`. La clave debe
 * derivarse de un identificador de la operación (`session_id`/order) para que
 * dos compras legítimas no se colapsen. Sin consentimiento es no-op y NO marca
 * la clave (si el usuario acepta después, aún puede emitirse).
 */
export function trackOnce(key: string, event: string, props?: Record<string, unknown>): boolean {
  if (!ensureInit()) return false;
  let store: Storage | null = null;
  try {
    store = typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch { /* almacén no disponible (modo privado) */ }
  if (store && !claimOnce(store, `sl-track:${key}`)) return false;
  posthog.capture(event, withDevice(props));
  return true;
}

/**
 * Vincula el dispositivo a una identidad (al hacer login). Mantiene el
 * distinct_id propio de PostHog (el email en el login actual) para no
 * colapsar usuarios distintos de un mismo dispositivo; el `device_id` viaja
 * como property, que es la clave de unión con los eventos de servidor (#239).
 */
export function identify(id: string, props?: Record<string, unknown>): void {
  if (!ensureInit()) return;
  posthog.identify(id, withDevice(props));
}

/** Propiedades de persona (idioma, tema...) sin evento dedicado. */
export function setPersonProps(props: Record<string, unknown>): void {
  if (!ensureInit()) return;
  posthog.setPersonProperties(props);
}

export function resetIdentity(): void {
  if (!ensureInit()) return;
  posthog.reset();
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const LOCALE_RE = /^\/(es|en|pt|fr|it)(?=\/|$)/;

/** /es/matches/0073f9… → { route: '/matches/:id', locale: 'es' } */
export function normalizeRoute(pathname: string): { route: string; locale: string | null } {
  const m = pathname.match(LOCALE_RE);
  const locale = m ? m[1]! : null;
  const route = (pathname.replace(LOCALE_RE, '') || '/').replace(UUID_RE, ':id');
  return { route, locale };
}

export interface SearchEventProps {
  /** Longitud de la query normalizada (sin el texto: evita PII, ver #240). */
  query_length: number;
  query_terms: number;
  result_count: number;
  has_results: boolean;
}

/**
 * Props de `search_performed` (#240) SIN la query en claro: una búsqueda puede
 * contener datos personales (nombres), así que solo agregamos longitud y número
 * de términos. `result_count`/`has_results` permiten medir los "cero resultados".
 */
export function searchEventProps(query: string, resultCount: number): SearchEventProps {
  const normalized = query.trim().replace(/\s+/g, ' ');
  return {
    query_length: normalized.length,
    query_terms: normalized ? normalized.split(' ').length : 0,
    result_count: resultCount,
    has_results: resultCount > 0,
  };
}

export interface MatchAnalyticsDecision {
  /** Emitir `match_view`: primera vez o cambio real de estado (no en cada poll). */
  emitView: boolean;
  /** Emitir `live_match_followed`: solo en la primera llegada a `live` (#241). */
  emitLiveFollowed: boolean;
}

/**
 * Decide la analítica al cambiar el estado de un partido (#241). Evita que
 * `match_view.status` quede congelado en el snapshot SSR: se re-emite en la
 * transición `scheduled → live`/`live → finished`, y `live_match_followed`
 * (NSM) cuenta también cuando el usuario abre antes del saque y se queda.
 */
export function matchAnalyticsDecision(prevStatus: string | null, status: string): MatchAnalyticsDecision {
  return {
    emitView: prevStatus !== status,
    emitLiveFollowed: status === 'live' && prevStatus !== 'live',
  };
}

/** Entidad que se puede marcar como favorita (estrella). */
export type FavoriteKind = 'team' | 'league' | 'player';

export interface FavoriteToggleEvent {
  event: 'favorite_added' | 'favorite_removed';
  props: {
    kind: FavoriteKind;
    ref_id: string;
    total_favorites: number;
    preset_selected?: string;
  };
}

/**
 * Evento ÚNICO al marcar/desmarcar un favorito (#243).
 *
 * Antes la estrella emitía DOS eventos para una sola intención: el hook
 * `useFavorites` ya emitía `favorite_added`/`favorite_removed` y, además,
 * `FavoriteStar` emitía `follow_created` al empezar a seguir. Decisión: se
 * mantiene `favorite_added` como evento canónico (NO se renombra la serie
 * histórica, para no romper dashboards) y el preset elegido viaja como
 * propiedad `preset_selected`. Se deja de emitir `follow_created` (deprecado
 * por esta unificación).
 */
export function favoriteToggleEvent(
  adding: boolean,
  kind: FavoriteKind,
  refId: string,
  total: number,
  preset?: string,
): FavoriteToggleEvent {
  return {
    event: adding ? 'favorite_added' : 'favorite_removed',
    props: {
      kind,
      ref_id: refId,
      total_favorites: total,
      // El preset solo tiene sentido al AÑADIR (al quitar no se eligió ninguno).
      ...(adding && preset ? { preset_selected: preset } : {}),
    },
  };
}

/** Estados del stream de directo que reportamos desde el cliente (#244). */
export type LiveStreamStatus = 'connecting' | 'live' | 'error' | 'timeout' | 'finished';

/** Pageviews manuales — montar una vez en el layout. */
export function AnalyticsPageview() {
  const pathname = usePathname();
  const last = useRef<string | null>(null);

  // Captura tras inicializar. Devuelve false si la analítica no está disponible
  // (sin consentimiento): en ese caso no se marca la ruta como vista.
  const capturePage = useCallback((path: string): boolean => {
    if (!ensureInit()) return false;
    const { route, locale } = normalizeRoute(path);
    posthog.capture('$pageview', withDevice({
      $current_url: window.location.href,
      route,
      locale,
    }));
    // El pageview normaliza los UUID a `:id`; estas vistas conservan QUÉ
    // competición/equipo se consultó (#171).
    const view = entityViewFromPath(path);
    if (view) {
      const idProp = entityIdProp(view.event);
      posthog.capture(view.event, withDevice({ [idProp]: view.id, locale }));
    }
    return true;
  }, []);

  useEffect(() => {
    if (!pathname || pathname === last.current) return;
    if (!capturePage(pathname)) return;
    last.current = pathname;
  }, [pathname, capturePage]);

  // Si el usuario acepta en caliente (misma pestaña o en otra), inicializa y
  // registra la página actual, que quedó sin capturar porque el efecto anterior
  // corrió antes de la elección.
  useEffect(() => {
    if (!pathname) return;
    const captureIfAllowed = () => {
      if (!isAnalyticsAllowed(readConsent())) return;
      if (last.current === pathname) return;
      if (capturePage(pathname)) last.current = pathname;
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === CONSENT_KEY || e.key === null) captureIfAllowed();
    };
    window.addEventListener(CONSENT_EVENT, captureIfAllowed);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(CONSENT_EVENT, captureIfAllowed);
      window.removeEventListener('storage', onStorage);
    };
  }, [pathname, capturePage]);

  return null;
}

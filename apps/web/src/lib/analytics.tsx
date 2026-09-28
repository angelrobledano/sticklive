'use client';

/**
 * Analítica de producto (PostHog) — instrumentación explícita.
 *
 * Principios:
 *  · Consentimiento previo (RGPD/ePrivacy): PostHog NO se inicializa ni
 *    persiste nada hasta que el usuario acepta (ver `lib/consent.ts`).
 *    Sin consentimiento, `track`/`identify`/... son no-op.
 *  · Autocapture APAGADO: solo eventos con nombre e intención (plan de tracking).
 *  · No se captura en desarrollo salvo NEXT_PUBLIC_POSTHOG_DEBUG=1.
 *  · person_profiles: 'identified_only' → los anónimos no crean perfil
 *    (ahorra coste y ruido); el perfil nace al hacer login.
 *  · Identidad alineada con el servidor (#239): el distinct_id anónimo es el
 *    `device_id` (`rink-device-id`), el mismo que usan los eventos de servidor
 *    (push, premium). Además, cada evento lleva `device_id` como property para
 *    poder unir cliente↔servidor incluso tras hacer login.
 *  · Pageviews manuales con ruta NORMALIZADA (/matches/:id, no el uuid),
 *    con locale como propiedad — agregables sin limpieza posterior.
 *
 * Plan de eventos:
 *  $pageview                 route, locale, device_id
 *  competition_view          competition_id, locale, device_id
 *  team_view                 team_id, locale, device_id
 *  match_view                match_id, status (scheduled|live|finished)
 *  favorite_added/removed    kind (team|league), ref_id, total_favorites
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
import { entityViewFromPath } from '@/lib/analytics-entity';
import { CONSENT_EVENT, CONSENT_KEY, isAnalyticsAllowed, readConsent } from '@/lib/consent';

const KEY  = process.env['NEXT_PUBLIC_POSTHOG_KEY'];
const HOST = process.env['NEXT_PUBLIC_POSTHOG_HOST'] ?? 'https://eu.i.posthog.com';
const ENABLED =
  !!KEY &&
  (process.env.NODE_ENV === 'production' || process.env['NEXT_PUBLIC_POSTHOG_DEBUG'] === '1');

/** Mismo identificador de dispositivo que usan API/ETL para los eventos de servidor. */
const DEVICE_KEY = 'rink-device-id';

let initialized = false;

/** Lee el `device_id` de localStorage. Sin navegador o sin clave → null. */
function readDeviceId(): string | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage.getItem(DEVICE_KEY) : null;
  } catch {
    return null;
  }
}

/** Añade `device_id` a las propiedades de cada evento cliente (#239). */
function withDevice(props?: Record<string, unknown>): Record<string, unknown> {
  const deviceId = readDeviceId();
  return deviceId ? { ...(props ?? {}), device_id: deviceId } : { ...(props ?? {}) };
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
      const idProp = view.event === 'competition_view' ? 'competition_id' : 'team_id';
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

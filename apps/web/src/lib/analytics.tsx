'use client';

/**
 * Analítica de producto (PostHog) — instrumentación explícita.
 *
 * Principios:
 *  · Autocapture APAGADO: solo eventos con nombre e intención (plan de tracking).
 *  · No se captura en desarrollo salvo NEXT_PUBLIC_POSTHOG_DEBUG=1.
 *  · person_profiles: 'identified_only' → los anónimos no crean perfil
 *    (ahorra coste y ruido); el perfil nace al hacer login.
 *  · Pageviews manuales con ruta NORMALIZADA (/matches/:id, no el uuid),
 *    con locale como propiedad — agregables sin limpieza posterior.
 *
 * Plan de eventos:
 *  $pageview                 route, locale
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
import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

const KEY  = process.env['NEXT_PUBLIC_POSTHOG_KEY'];
const HOST = process.env['NEXT_PUBLIC_POSTHOG_HOST'] ?? 'https://eu.i.posthog.com';
const ENABLED =
  !!KEY &&
  (process.env.NODE_ENV === 'production' || process.env['NEXT_PUBLIC_POSTHOG_DEBUG'] === '1');

let initialized = false;

function ensureInit(): boolean {
  if (!ENABLED || typeof window === 'undefined') return false;
  if (!initialized) {
    posthog.init(KEY!, {
      api_host: HOST,
      capture_pageview: false,   // pageviews manuales (App Router)
      capture_pageleave: true,   // duración de sesión/página
      autocapture: false,        // solo eventos del plan
      person_profiles: 'identified_only',
    });
    initialized = true;
  }
  return true;
}

/** Evento del plan de tracking. No-op si la analítica está apagada. */
export function track(event: string, props?: Record<string, unknown>): void {
  if (!ensureInit()) return;
  posthog.capture(event, props);
}

/** Vincula el dispositivo a una identidad (al hacer login). */
export function identify(id: string, props?: Record<string, unknown>): void {
  if (!ensureInit()) return;
  posthog.identify(id, props);
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

  useEffect(() => {
    if (!pathname || pathname === last.current) return;
    last.current = pathname;
    if (!ensureInit()) return;
    const { route, locale } = normalizeRoute(pathname);
    posthog.capture('$pageview', {
      $current_url: window.location.href,
      route,
      locale,
    });
  }, [pathname]);

  return null;
}

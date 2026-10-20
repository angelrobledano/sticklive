// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { getConsentState, type ConsentState } from "@/lib/consent-tcf";

/**
 * Política de grabación de sesión de Sentry (#340). Pura y testeable.
 *
 * Antes se grababan DOS sesiones en paralelo (Sentry Replay + recorder de
 * PostHog) para cada usuario. Con esta política:
 *   · Sin consentimiento de analítica → no se añade Replay en absoluto: ningún
 *     grabador toca el DOM (privacidad, ver #246).
 *   · Con consentimiento → se desactiva la grabación continua
 *     (`sessionSampleRate: 0`) y solo se conserva el buffer que se envía si hay
 *     un error (`onErrorSampleRate: 1`). Se mantiene el error tracking normal.
 *
 * Trade-off: sin grabación continua no podemos reproducir navegaciones que no
 * acaban en error; a cambio se elimina CPU/red constantes en gama baja.
 */
export interface SentryReplayPolicy {
  /** ¿Se registra la integración de Replay? */
  enabled: boolean;
  /** Muestreo de sesiones completas (0 = nunca). */
  sessionSampleRate: number;
  /** Muestreo cuando hay un error (buffer de replay). */
  onErrorSampleRate: number;
}

export function sentryReplayPolicy(consent: ConsentState): SentryReplayPolicy {
  if (consent !== 'granted') {
    return { enabled: false, sessionSampleRate: 0, onErrorSampleRate: 0 };
  }
  return { enabled: true, sessionSampleRate: 0, onErrorSampleRate: 1.0 };
}

function initSentry(): void {
  const replay = sentryReplayPolicy(getConsentState());
  Sentry.init({
    dsn: "https://53cf0f7790b3d4ce13441e1d9c73d536@o4511608627462144.ingest.de.sentry.io/4511608643780688",

    // #340: Replay solo si hay consentimiento (y solo en error, ver política).
    integrations: replay.enabled ? [Sentry.replayIntegration()] : [],

    // 100% en desarrollo, 10% en producción (controla coste/cuota).
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
    // Enable logs to be sent to Sentry
    enableLogs: true,

    // #340: sin grabación continua; con consentimiento, replay solo en error.
    replaysSessionSampleRate: replay.sessionSampleRate,
    replaysOnErrorSampleRate: replay.onErrorSampleRate,

    // Enable sending user PII (Personally Identifiable Information)
    // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
    sendDefaultPii: false,
  });
}

/**
 * #354: React deja sin consumir los contenedores `<div hidden id="S:n">` que usa
 * el SSR por streaming (home por `loading.tsx`; ficha de competición por los
 * `<Suspense>` de sus pestañas). Quedan ocultos pero duplican el DOM. Como los
 * límites que los originan viven en componentes fuera de este cambio, aquí
 * aplicamos la mitigación defensiva que propone el issue: limpiarlos DESPUÉS de
 * hidratar para que React haya tenido ocasión de consumirlos.
 */
export function isStreamContainerId(id: string | null | undefined): boolean {
  return typeof id === 'string' && /^S:\d+$/.test(id);
}

export interface StreamCleanupRoot {
  querySelectorAll(selector: string): ArrayLike<{ id: string; remove(): void }>;
}

export function stripLeftoverStreamContainers(root: StreamCleanupRoot): number {
  let removed = 0;
  const nodes = root.querySelectorAll('body > div[hidden][id^="S:"]');
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i];
    if (el && isStreamContainerId(el.id)) {
      el.remove();
      removed++;
    }
  }
  return removed;
}

function cleanupLeftoverStreamContainers(): void {
  try {
    stripLeftoverStreamContainers(document as unknown as StreamCleanupRoot);
  } catch {
    /* noop: la limpieza es best-effort y nunca debe romper la página */
  }
}

if (typeof window !== "undefined") {
  initSentry();
  // `load` llega con la hidratación ya iniciada; el frame extra deja que React
  // consuma los templates antes de retirar los restos.
  const scheduleCleanup = () => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(cleanupLeftoverStreamContainers);
    } else {
      cleanupLeftoverStreamContainers();
    }
  };
  if (document.readyState === "complete") {
    scheduleCleanup();
  } else {
    window.addEventListener("load", scheduleCleanup, { once: true });
  }
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

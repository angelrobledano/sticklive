// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://53cf0f7790b3d4ce13441e1d9c73d536@o4511608627462144.ingest.de.sentry.io/4511608643780688",

  // 100% en desarrollo, 10% en producción (controla coste/cuota).
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

  // Enable logs to be sent to Sentry
  enableLogs: true,

  // Enable sending user PII (Personally Identifiable Information)
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
  sendDefaultPii: true,

  // F1-6: una ficha oculta por una revisión de datos reciente responde 5xx a
  // propósito (TemporarilyHiddenError, lib/entity-redirect.ts) para que Google
  // no la desindexe. No es un fallo: no debe llegar a Sentry.
  ignoreErrors: [/oculto temporalmente por revisión de datos/],
});

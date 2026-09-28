/**
 * Inicialización de Sentry para el ETL/scraper (Node).
 * Importar ANTES que cualquier otro módulo en cada entrypoint (cron-live, etc.).
 * OJO procesos cortos: hay que `Sentry.flush()` antes de salir o se pierden los
 * eventos (el cron arranca y termina). Si SENTRY_DSN no está, init es no-op.
 */
import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env['SENTRY_DSN'],
  environment: process.env['NODE_ENV'] ?? 'production',
  serverName: 'etl',
  tracesSampleRate: process.env['NODE_ENV'] === 'production' ? 0.1 : 1.0,
  // #333: no enviar PII por defecto (el API ya lo tiene a false). Evita que los
  // breadcrumbs HTTP hacia sidgad arrastren datos personales a Sentry.
  sendDefaultPii: false,
  initialScope: { tags: { service: 'etl' } },
});

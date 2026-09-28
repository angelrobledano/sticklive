/**
 * Inicialización de Sentry para `apps/scraper` (Node).
 * Importar ANTES que cualquier otro módulo en cada entrypoint.
 *
 * El scraper corre como proceso corto (`--run-once <clave>`): hay que
 * `Sentry.flush()` antes de salir o se pierden los eventos. Si SENTRY_DSN no
 * está, `Sentry.init` es no-op y no rompe nada.
 */
import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env['SENTRY_DSN'],
  environment: process.env['NODE_ENV'] ?? 'production',
  serverName: 'scraper',
  tracesSampleRate: process.env['NODE_ENV'] === 'production' ? 0.1 : 1.0,
  // No enviar PII por defecto (mismo criterio que el ETL y el API).
  sendDefaultPii: false,
  initialScope: { tags: { service: 'scraper' } },
});

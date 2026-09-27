/**
 * Inicialización de Sentry para la API (Node).
 * Debe importarse ANTES que cualquier otro módulo (ver index.ts) para que la
 * auto-instrumentación enganche http/fetch/etc.
 * Si SENTRY_DSN no está definido, init es no-op (seguro en local/sin Sentry).
 */
import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env['SENTRY_DSN'],
  environment: process.env['NODE_ENV'] ?? 'production',
  serverName: 'api',
  // 100% en dev, 10% en prod (controla cuota)
  tracesSampleRate: process.env['NODE_ENV'] === 'production' ? 0.1 : 1.0,
  sendDefaultPii: false,
  initialScope: { tags: { service: 'api' } },
});

/**
 * Verificación de Sentry backend (Node). BORRAR tras comprobar que aparece en
 * Issues del proyecto sticklive-backend.
 * Uso (PowerShell):
 *   cd apps\etl
 *   $env:SENTRY_DSN="<dsn-del-proyecto-node>"
 *   npx tsx src/sentry-test.ts
 */
import './instrument.js'; // Sentry.init (lee SENTRY_DSN del entorno)
import * as Sentry from '@sentry/node';

try {
  // @ts-expect-error función inexistente a propósito
  foo();
} catch (e) {
  Sentry.captureException(e);
}

await Sentry.flush(2000);
console.log('Evento enviado. Si SENTRY_DSN estaba definido, míralo en Issues (sticklive-backend). Luego borra este fichero.');

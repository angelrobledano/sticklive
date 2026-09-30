/**
 * Captura de errores de ruta hacia Sentry (#315).
 *
 * Las rutas hacen try/catch para devolver su propio 500 — pero eso ESQUIVA
 * Sentry: la instrumentación HTTP sólo ve la respuesta, no la excepción, y una
 * caída de Postgres quedaba como "500 Database error" sin evento. Los catch que
 * responden 500 llaman a este helper ANTES de responder.
 *
 * Los catches de errores ESPERADOS (auth fallida, validación, 404 de negocio,
 * recursos ausentes) NO deben llamarlo: no son incidencias, y capturarlos
 * espamearía la cuota.
 */
import * as Sentry from '@sentry/node';

export function captureRouteError(err: unknown, route: string): void {
  Sentry.captureException(err, { tags: { route } });
}

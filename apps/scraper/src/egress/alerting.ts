/**
 * Alertas de la salida SIDGAD.
 *
 * Se reutiliza Sentry (ya presente en scraper/ETL) en vez de introducir otra
 * infraestructura. El throttle evita que un 403 persistente abra un incidente
 * nuevo cada 45 segundos.
 */
import * as Sentry from '@sentry/node';
import type { EgressRouteKind, SidgadFailureKind } from './types.js';

export type EgressAlertKind = 'circuit_open' | 'circuit_recovered' | 'forbidden' | 'config';

export interface EgressAlert {
  kind: EgressAlertKind;
  route: EgressRouteKind;
  portal: string;
  message: string;
  failureKind?: SidgadFailureKind;
  status?: number;
  failures?: number;
  cooldownMs?: number;
}

const lastSent = new Map<string, number>();

function alertKey(alert: EgressAlert): string {
  return `${alert.kind}:${alert.route}:${alert.portal}`;
}

/**
 * Envía la alerta si no se envió una igual dentro de la ventana.
 * Devuelve true si se envió.
 */
export function sendEgressAlert(
  alert: EgressAlert,
  throttleMs: number,
  now: number = Date.now()
): boolean {
  const key = alertKey(alert);
  const previous = lastSent.get(key);
  if (previous !== undefined && now - previous < throttleMs) return false;
  lastSent.set(key, now);

  const level = alert.kind === 'circuit_recovered' ? 'info' : 'error';
  Sentry.captureMessage(alert.message, {
    level,
    tags: {
      egress_alert: alert.kind,
      egress_route: alert.route,
      egress_portal: alert.portal,
    },
    extra: {
      failureKind: alert.failureKind,
      status: alert.status,
      failures: alert.failures,
      cooldownMs: alert.cooldownMs,
    },
  });
  return true;
}

/** Solo para tests. */
export function resetEgressAlertThrottle(): void {
  lastSent.clear();
}

/**
 * Punto de entrada de la capa de salida SIDGAD.
 *
 * El singleton es perezoso: si el proceso no habla con SIDGAD (p. ej. la API),
 * no se lee la configuración ni se crea nada. Todos los `SidgadClient` del
 * proceso comparten circuit breakers y métricas.
 */
import { createLogger, type Logger } from '@sports/logger';
import { describeEgressConfig, loadEgressConfig } from './config.js';
import { SidgadEgress } from './egress.js';
import type { EgressConfig } from './types.js';

export { SidgadEgress } from './egress.js';
export type { SidgadEgressDeps } from './egress.js';
export * from './types.js';
export { SidgadEgressError, httpError, computeBackoffMs, parseRetryAfter } from './errors.js';
export { buildWorkerPath, signEgressRequest } from './hmac.js';

let egress: SidgadEgress | null = null;
let configLogged = false;

export function getSidgadEgress(env: Record<string, string | undefined> = process.env): SidgadEgress {
  if (!egress) {
    const config = loadEgressConfig(env);
    egress = new SidgadEgress({ config });
    logEgressConfig(config);
  }
  return egress;
}

export function logEgressConfig(config: EgressConfig, logger?: Logger): void {
  if (configLogged) return;
  configLogged = true;
  const log = logger ?? createLogger({ module: 'sidgad-egress' });
  const safe = describeEgressConfig(config);
  log.info({ egress: safe }, 'Configuración de salida SIDGAD');

  if (config.primary !== 'direct') {
    log.warn(
      { primary: config.primary, fallbacks: config.fallbacks },
      'La salida principal de SIDGAD NO es la directa. Confirma que SIDGAD autorizó esta ruta por escrito.'
    );
  }
  if (config.fallbacks.length > 0) {
    log.warn(
      { fallbacks: config.fallbacks },
      'Hay rutas de respaldo SIDGAD activas: solo se usarán ante fallos de transporte, nunca ante 403/429.'
    );
  }
}

/**
 * Resumen de métricas de salida en el log estructurado existente.
 * No hace nada si el proceso aún no ha hablado con SIDGAD.
 */
export function logEgressSummary(log: Logger, level: 'info' | 'debug' = 'info'): void {
  if (!egress) return;
  const metrics = egress.metrics.snapshot();
  if (metrics.entries.length === 0) return;
  if (level === 'debug') log.debug({ egress: metrics }, 'Resumen de salida SIDGAD');
  else log.info({ egress: metrics }, 'Resumen de salida SIDGAD');
}

/** Configuración resuelta sin crear el singleton (para diagnóstico). */
export function describeCurrentEgressConfig(
  env: Record<string, string | undefined> = process.env
): Record<string, unknown> {
  return describeEgressConfig(loadEgressConfig(env));
}

/** Estado actual (config + métricas + circuitos), o null si no se usó SIDGAD. */
export function egressSnapshot(): Record<string, unknown> | null {
  return egress?.snapshot() ?? null;
}

/** Solo para tests: olvida el singleton y la caché de configuración. */
export function resetSidgadEgressForTests(): void {
  egress = null;
  configLogged = false;
}

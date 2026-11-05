/**
 * Router de salida SIDGAD.
 *
 * Orden de rutas: primaria y, si se agotan los reintentos por un fallo de
 * TRANSPORTE (DNS/red/timeout), las de respaldo autorizadas.
 *
 * Lo que este router NO hace, a propósito:
 *   · No cambia de ruta ante un 403/401 (sería eludir una restricción).
 *   · No cambia de ruta ante un 429 (sería eludir un rate limit).
 *   · No cambia de ruta ante un 5xx (el problema es de SIDGAD, no de nuestra
 *     conectividad; cambiar de IP no lo arregla y añade carga).
 *   · No reintenta 404 ni errores de configuración.
 */
import { isSidgadPaused } from './pause.js';
import { createLogger, type Logger } from '@sports/logger';
import { CircuitBreaker } from './circuit-breaker.js';
import { SidgadGuard } from '../scrapers/fep/sidgad-guard.js';
import { EgressMetrics } from './metrics.js';
import {
  classifyTransportError,
  computeBackoffMs,
  configError,
  httpError,
  isFailoverEligible,
  SidgadEgressError,
} from './errors.js';
import { sendEgressAlert, type EgressAlert } from './alerting.js';
import { FetchTransport } from './transport-fetch.js';
import { CloudflareWorkerTransport } from './transport-cloudflare.js';
import { LocalAddressTransport } from './transport-node.js';
import { describeEgressConfig } from './config.js';
import type {
  EgressConfig,
  EgressRequest,
  EgressResponse,
  EgressRouteConfig,
  EgressRouteKind,
  EgressTransport,
  RawEgressResponse,
  SidgadFailureKind,
} from './types.js';

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export interface SidgadEgressDeps {
  config: EgressConfig;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  logger?: Logger;
  metrics?: EgressMetrics;
  transports?: Partial<Record<EgressRouteKind, EgressTransport>>;
  alert?: (alert: EgressAlert) => void;
}

export class SidgadEgress {
  readonly metrics: EgressMetrics;
  private readonly config: EgressConfig;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly log: Logger;
  private readonly alert: (alert: EgressAlert) => void;
  private readonly routes: EgressRouteConfig[];
  private readonly transports: Record<EgressRouteKind, EgressTransport>;
  private readonly breakers = new Map<string, CircuitBreaker>();
  /** Pausa tras 403/429 y espaciado, por ruta y host (ver EgressConfig.pauseOnBlock). */
  private readonly guard: SidgadGuard;

  constructor(deps: SidgadEgressDeps) {
    this.config = deps.config;
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? defaultSleep;
    this.random = deps.random ?? Math.random;
    this.log = deps.logger ?? createLogger({ module: 'sidgad-egress' });
    this.metrics = deps.metrics ?? new EgressMetrics();
    this.guard = new SidgadGuard(this.now);
    this.alert =
      deps.alert ??
      ((alert) => {
        sendEgressAlert(alert, this.config.alertThrottleMs, this.now());
      });

    this.routes = [this.config.primary, ...this.config.fallbacks].map((kind) => {
      const route = this.config.routes[kind];
      if (!route.enabled || !route.authorized) {
        throw configError(`La ruta de salida "${kind}" no está habilitada y autorizada.`, kind);
      }
      return route;
    });

    this.transports = {
      direct: deps.transports?.direct ?? new FetchTransport(),
      cloudflare: deps.transports?.cloudflare ?? new CloudflareWorkerTransport(this.now),
      'secondary-ip': deps.transports?.['secondary-ip'] ?? new LocalAddressTransport(),
    };
  }

  /** Vista segura de configuración, métricas y estado de los circuitos. */
  snapshot(): Record<string, unknown> {
    return {
      config: describeEgressConfig(this.config),
      metrics: this.metrics.snapshot(),
      circuits: [...this.breakers.entries()].map(([key, breaker]) => ({
        key,
        ...breaker.snapshot(),
      })),
    };
  }

  async request(request: EgressRequest): Promise<EgressResponse> {
    if (isSidgadPaused()) {
      throw new SidgadEgressError({
        kind: 'paused',
        message: 'Salida a SIDGAD pausada a mano (SIDGAD_PAUSED=1).',
        route: this.routes[0]?.kind ?? 'direct',
        portal: request.portal,
        url: request.url,
        retryable: false,
        failover: false,
      });
    }
    const errors: SidgadEgressError[] = [];

    for (let index = 0; index < this.routes.length; index++) {
      const route = this.routes[index]!;
      const breaker = this.breakerFor(route.kind, request.portal);

      if (!breaker.allow()) {
        this.metrics.recordCircuitReject(route.kind, request.portal);
        this.log.warn(
          {
            route: route.kind,
            portal: request.portal,
            circuit: breaker.snapshot(),
          },
          'Circuito de salida SIDGAD abierto — se omite la ruta'
        );
        errors.push(
          new SidgadEgressError({
            kind: 'network',
            message: `Circuito abierto para la salida "${route.kind}" (${request.portal}).`,
            route: route.kind,
            portal: request.portal,
            url: request.url,
            retryable: true,
            failover: true,
          })
        );
        continue;
      }

      // Pausa tras un 403/429 en ESTA ruta: no se insiste ni se cambia de ruta.
      const guardKey = `${route.kind}:${hostOf(request.url)}`;
      if (this.config.pauseOnBlock) {
        const paused = this.guard.remaining(guardKey);
        if (paused > 0) {
          throw new SidgadEgressError({
            kind: 'rate_limited',
            message: `Salida «${route.kind}» en pausa tras un bloqueo de SIDGAD; quedan ${Math.ceil(paused / 1000)} s.`,
            route: route.kind,
            portal: request.portal,
            url: request.url,
            retryable: false,
            failover: false,
          });
        }
      }
      if (this.config.minGapMs) {
        const wait = this.guard.reserve(guardKey, this.config.minGapMs);
        if (wait > 0) await this.sleep(wait);
      }

      this.metrics.recordRequest(route.kind, request.portal);

      try {
        const raw = await this.executeWithRetries(route, request);
        if (this.config.pauseOnBlock) this.guard.ok(guardKey);
        const recovered = breaker.recordSuccess();
        this.metrics.recordSuccess(route.kind, request.portal, raw.latencyMs, recovered, this.now());

        if (recovered) {
          this.log.info(
            { route: route.kind, portal: request.portal },
            'Salida SIDGAD recuperada'
          );
          this.alert({
            kind: 'circuit_recovered',
            route: route.kind,
            portal: request.portal,
            message: `Salida SIDGAD "${route.kind}" recuperada para el portal ${request.portal}.`,
          });
        }

        return { ...raw, route: route.kind };
      } catch (error) {
        const failure = this.asEgressError(error, route, request);
        const countsForCircuit = shouldCountForCircuit(failure);
        const justOpened = countsForCircuit ? breaker.recordFailure() : false;

        this.metrics.recordFailure(route.kind, request.portal, failure, this.now());

        if (justOpened) {
          this.metrics.recordCircuitOpen(route.kind, request.portal);
          this.log.error(
            {
              route: route.kind,
              portal: request.portal,
              failure: failure.toLogObject(),
              circuit: breaker.snapshot(),
            },
            'Circuito de salida SIDGAD abierto — se deja de llamar temporalmente'
          );
          this.alert({
            kind: 'circuit_open',
            route: route.kind,
            portal: request.portal,
            message:
              `Salida SIDGAD "${route.kind}" abierta para el portal ${request.portal} ` +
              `tras ${this.config.circuitFailureThreshold} fallos consecutivos. ` +
              `Se reintentará en ${this.config.circuitCooldownMs} ms.`,
            failureKind: failure.kind,
            ...(failure.status !== undefined ? { status: failure.status } : {}),
            failures: this.config.circuitFailureThreshold,
            cooldownMs: this.config.circuitCooldownMs,
          });
        }

        if (this.config.pauseOnBlock && (failure.kind === 'forbidden' || failure.kind === 'rate_limited')) {
          const pause = this.guard.blocked(guardKey);
          this.log.warn({ route: route.kind, portal: request.portal, pauseMin: pause / 60_000 },
            'SIDGAD bloquea: pausa de la ruta, sin reintentos');
        }

        if (failure.kind === 'forbidden') {
          this.log.error(
            { route: route.kind, portal: request.portal, status: failure.status },
            'SIDGAD 403/401: posible restricción de autorización. NO se cambia de ruta.'
          );
          this.alert({
            kind: 'forbidden',
            route: route.kind,
            portal: request.portal,
            message:
              `SIDGAD respondió ${failure.status ?? '403'} en la salida "${route.kind}" ` +
              `(portal ${request.portal}). Posible restricción de acceso o autorización; ` +
              'no se cambia de ruta automáticamente.',
            status: failure.status,
          });
        }

        // Un error de configuración de NUESTRA ruta (p. ej. el Worker rechaza
        // el secreto) no se reintenta, pero sí puede caer al fallback
        // autorizado para no tumbar el directo. Se alerta para que se corrija.
        if (failure.kind === 'config') {
          this.log.error(
            { route: route.kind, portal: request.portal, message: failure.message },
            'Fallo de configuración de la salida SIDGAD — se usará un fallback autorizado si existe'
          );
          this.alert({
            kind: 'config',
            route: route.kind,
            portal: request.portal,
            message: failure.message,
          });
        }

        const nextRoute = this.routes[index + 1];
        const canFailover =
          isFailoverEligible(failure) || (failure.kind === 'config' && nextRoute !== undefined);
        if (!canFailover) throw failure;

        errors.push(failure);
        if (nextRoute) {
          this.metrics.recordFailover(route.kind, request.portal);
          this.log.warn(
            {
              from: route.kind,
              to: nextRoute.kind,
              portal: request.portal,
              failure: failure.toLogObject(),
            },
            'Fallo de transporte SIDGAD — probando la siguiente salida autorizada'
          );
        }
      }
    }

    throw (
      errors[errors.length - 1] ??
      configError('No hay rutas de salida SIDGAD disponibles.', this.config.primary, 'unknown')
    );
  }

  private async executeWithRetries(
    route: EgressRouteConfig,
    request: EgressRequest
  ): Promise<RawEgressResponse> {
    const transport = this.transports[route.kind];
    const attempts = Math.max(1, request.retries ?? this.config.retries);
    let lastFailure: SidgadEgressError | null = null;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const raw = await transport.execute(
          { ...request, timeoutMs: request.timeoutMs || this.config.timeoutMs },
          route
        );
        const failure = this.httpFailure(raw, route, request);
        if (failure) throw failure;
        return raw;
      } catch (error) {
        const failure = this.asEgressError(error, route, request, attempt);
        lastFailure = failure;

        if (!failure.retryable || attempt >= attempts) throw failure;

        const backoffMs = computeBackoffMs(
          attempt,
          request.retryBaseMs ?? this.config.retryBaseMs,
          this.config.retryMaxMs,
          this.random
        );
        const delayMs =
          failure.retryAfterMs !== undefined
            ? Math.min(failure.retryAfterMs, this.config.maxRetryAfterMs)
            : backoffMs;

        this.metrics.recordRetry(route.kind, request.portal);
        this.log.warn(
          {
            route: route.kind,
            portal: request.portal,
            status: failure.status,
            kind: failure.kind,
            attempt,
            attempts,
            delayMs,
          },
          'Reintentando petición SIDGAD'
        );
        await this.sleep(delayMs);
      }
    }

    throw lastFailure ?? configError('Reintentos SIDGAD agotados sin error registrado.', route.kind, request.portal);
  }

  private httpFailure(
    raw: RawEgressResponse,
    route: EgressRouteConfig,
    request: EgressRequest
  ): SidgadEgressError | null {
    if (raw.status >= 200 && raw.status < 300) return null;

    if (raw.errorCode && WORKER_CONFIG_ERRORS.has(raw.errorCode)) {
      return configError(
        `El Worker de salida rechazó la petición (${raw.errorCode}). Revisa secreto, URL y configuración.`,
        route.kind,
        request.portal
      );
    }
    if (raw.errorCode === 'upstream_timeout') {
      return new SidgadEgressError({
        kind: 'timeout',
        message: 'El Worker no pudo completar la petición a SIDGAD a tiempo.',
        route: route.kind,
        portal: request.portal,
        url: request.url,
        status: raw.status,
        retryable: true,
        failover: true,
        setCookie: raw.setCookie,
      });
    }
    if (raw.errorCode === 'upstream_error') {
      return new SidgadEgressError({
        kind: 'network',
        message: 'El Worker no pudo conectar con SIDGAD.',
        route: route.kind,
        portal: request.portal,
        url: request.url,
        status: raw.status,
        retryable: true,
        failover: true,
        setCookie: raw.setCookie,
      });
    }

    return httpError({
      status: raw.status,
      route: route.kind,
      portal: request.portal,
      url: request.url,
      retryAfter: raw.retryAfter,
      setCookie: raw.setCookie,
      now: this.now(),
    });
  }

  private asEgressError(
    error: unknown,
    route: EgressRouteConfig,
    request: EgressRequest,
    attempt?: number
  ): SidgadEgressError {
    if (error instanceof SidgadEgressError) {
      return attempt === undefined || error.attempts !== undefined
        ? error
        : new SidgadEgressError({
            kind: error.kind,
            message: error.message,
            route: error.route,
            portal: error.portal,
            url: error.url,
            retryable: error.retryable,
            failover: error.failover,
            ...(error.status !== undefined ? { status: error.status } : {}),
            ...(error.retryAfterMs !== undefined ? { retryAfterMs: error.retryAfterMs } : {}),
            ...(error.setCookie ? { setCookie: error.setCookie } : {}),
            attempts: attempt,
            cause: error,
          });
    }

    // Un transporte propio (o un test) puede lanzar un error crudo de Node.
    // Lo clasificamos igual que los transportes reales para no perder la
    // semántica de DNS/red/timeout.
    return classifyTransportError(error, {
      route: route.kind,
      portal: request.portal,
      url: request.url,
      timedOut: false,
      ...(attempt !== undefined ? { attempts: attempt } : {}),
    });
  }

  private breakerFor(route: EgressRouteKind, portal: string): CircuitBreaker {
    const key = `${route}:${portal}`;
    let breaker = this.breakers.get(key);
    if (!breaker) {
      breaker = new CircuitBreaker(
        this.config.circuitFailureThreshold,
        this.config.circuitCooldownMs,
        this.now
      );
      this.breakers.set(key, breaker);
    }
    return breaker;
  }
}

/** Errores propios del Worker que indican configuración, no conectividad. */
const WORKER_CONFIG_ERRORS = new Set([
  'unauthorized',
  'bad_request',
  'payload_too_large',
  'worker_misconfigured',
  'bad_path',
  'portal_not_allowed',
  'query_not_allowed',
  'method_not_allowed',
  'unsupported_media_type',
]);

function shouldCountForCircuit(error: SidgadEgressError): boolean {
  const kind: SidgadFailureKind = error.kind;
  // Solo los fallos de TRANSPORTE abren el circuito. Si un 429 o un 5xx lo
  // abriera, la siguiente petición saltaría al fallback y estaríamos cambiando
  // de IP ante un rate limit o un error de la fuente: exactamente lo que la
  // política prohíbe. Esos errores se reintentan/esperan, pero no cambian ruta.
  return kind === 'dns' || kind === 'network' || kind === 'timeout';
}

function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}

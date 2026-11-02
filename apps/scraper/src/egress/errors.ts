/**
 * Errores de SIDGAD y su clasificación.
 *
 * Distinguir el TIPO de fallo es lo que permite decidir bien:
 *   · red/DNS/timeout  → reintentar y, si se agota, probar otra ruta autorizada.
 *   · 403              → problema de autorización/restricción. NO se reintenta
 *                        y NO se cambia de IP (sería eludir una restricción).
 *   · 429              → rate limit. Se reintenta con Retry-After, sin cambiar
 *                        de ruta (cambiar de IP para saltarse el límite es
 *                        exactamente lo que no queremos hacer).
 *   · 5xx              → fallo de la fuente. Se reintenta, sin cambiar de ruta.
 *   · 404 / 4xx        → error de petición: no se reintenta.
 */
import type { EgressRouteKind, SidgadFailureKind } from './types.js';

export interface EgressErrorInit {
  kind: SidgadFailureKind;
  message: string;
  route: EgressRouteKind;
  portal: string;
  url: string;
  status?: number;
  retryable: boolean;
  failover?: boolean;
  retryAfterMs?: number;
  attempts?: number;
  setCookie?: string[];
  cause?: unknown;
}

export class SidgadEgressError extends Error {
  readonly kind: SidgadFailureKind;
  readonly route: EgressRouteKind;
  readonly portal: string;
  readonly url: string;
  readonly status?: number;
  readonly retryable: boolean;
  /** ¿Se puede probar otra ruta ante este fallo? Nunca para 403/429/4xx/5xx. */
  readonly failover: boolean;
  readonly retryAfterMs?: number;
  readonly attempts?: number;
  /** Cookies de una respuesta de error: el cliente puede renovar la sesión. */
  readonly setCookie?: string[];

  constructor(init: EgressErrorInit) {
    super(init.message);
    this.name = 'SidgadEgressError';
    this.kind = init.kind;
    this.route = init.route;
    this.portal = init.portal;
    this.url = init.url;
    this.retryable = init.retryable;
    this.failover = init.failover ?? false;
    if (init.status !== undefined) this.status = init.status;
    if (init.retryAfterMs !== undefined) this.retryAfterMs = init.retryAfterMs;
    if (init.attempts !== undefined) this.attempts = init.attempts;
    if (init.setCookie !== undefined) this.setCookie = init.setCookie;
    if (init.cause !== undefined) this.cause = init.cause;
  }

  /** Vista segura para logs: nunca incluye cabeceras, cookies ni cuerpo. */
  toLogObject(): Record<string, unknown> {
    return {
      kind: this.kind,
      route: this.route,
      portal: this.portal,
      status: this.status,
      retryable: this.retryable,
      failover: this.failover,
      retryAfterMs: this.retryAfterMs,
      attempts: this.attempts,
    };
  }
}

/** Convierte una respuesta HTTP no-2xx en un error clasificado. */
export function httpError(input: {
  status: number;
  route: EgressRouteKind;
  portal: string;
  url: string;
  retryAfter: string | null;
  setCookie?: string[];
  attempts?: number;
  now?: number;
}): SidgadEgressError {
  const { status, route, portal, url } = input;
  const base = { route, portal, url, status, ...(input.setCookie ? { setCookie: input.setCookie } : {}), ...(input.attempts ? { attempts: input.attempts } : {}) };

  if (status === 401 || status === 403) {
    return new SidgadEgressError({
      ...base,
      kind: 'forbidden',
      message:
        status === 403
          ? `SIDGAD devolvió 403 en ${url}. Posible restricción de acceso o autorización; no se cambia de ruta.`
          : `SIDGAD devolvió 401 en ${url}. La sesión o las credenciales no son válidas.`,
      retryable: false,
      failover: false,
    });
  }

  if (status === 429) {
    return new SidgadEgressError({
      ...base,
      kind: 'rate_limited',
      message: `SIDGAD devolvió 429 (rate limit) en ${url}. Se respeta Retry-After; no se cambia de ruta.`,
      retryable: true,
      failover: false,
      ...(parseRetryAfter(input.retryAfter, input.now) !== undefined
        ? { retryAfterMs: parseRetryAfter(input.retryAfter, input.now) }
        : {}),
    });
  }

  if (status >= 500 && status <= 599) {
    return new SidgadEgressError({
      ...base,
      kind: 'server',
      message: `SIDGAD devolvió ${status} en ${url}. Fallo de la fuente; se reintenta sin cambiar de ruta.`,
      retryable: true,
      failover: false,
    });
  }

  if (status === 408 || status === 425) {
    return new SidgadEgressError({
      ...base,
      kind: 'http',
      message: `SIDGAD devolvió ${status} en ${url}. Se reintenta sin cambiar de ruta.`,
      retryable: true,
      failover: false,
    });
  }

  return new SidgadEgressError({
    ...base,
    kind: 'client',
    message: `SIDGAD devolvió ${status} en ${url}. No se reintenta.`,
    retryable: false,
    failover: false,
  });
}

/** Extrae el código de error de una cadena de causas (undici/Node). */
export function errorCodeOf(err: unknown): string | undefined {
  let current: unknown = err;
  for (let depth = 0; depth < 6 && current && typeof current === 'object'; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && code.length > 0) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

function errorNameOf(err: unknown): string | undefined {
  return err && typeof err === 'object' && typeof (err as { name?: unknown }).name === 'string'
    ? (err as { name: string }).name
    : undefined;
}

/** Clasifica un fallo de transporte (no hubo respuesta HTTP). */
export function classifyTransportError(
  err: unknown,
  ctx: { route: EgressRouteKind; portal: string; url: string; timedOut: boolean; attempts?: number }
): SidgadEgressError {
  const common = {
    route: ctx.route,
    portal: ctx.portal,
    url: ctx.url,
    ...(ctx.attempts ? { attempts: ctx.attempts } : {}),
    cause: err,
  };

  if (errorNameOf(err) === 'ResponseTooLargeError') {
    return new SidgadEgressError({
      ...common,
      kind: 'response_too_large',
      message: `Respuesta de SIDGAD demasiado grande en ${ctx.url}. No se reintenta.`,
      retryable: false,
      failover: false,
    });
  }

  if (ctx.timedOut || errorNameOf(err) === 'TimeoutError') {
    return new SidgadEgressError({
      ...common,
      kind: 'timeout',
      message: `Timeout al conectar con SIDGAD en ${ctx.url}.`,
      retryable: true,
      failover: true,
    });
  }

  const code = errorCodeOf(err);
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'EAI_FAIL') {
    return new SidgadEgressError({
      ...common,
      kind: 'dns',
      message: `Error DNS al resolver SIDGAD (${code}) en ${ctx.url}.`,
      retryable: true,
      failover: true,
    });
  }

  if (
    code === 'ETIMEDOUT' ||
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    code === 'UND_ERR_HEADERS_TIMEOUT' ||
    code === 'UND_ERR_BODY_TIMEOUT'
  ) {
    return new SidgadEgressError({
      ...common,
      kind: 'timeout',
      message: `Timeout de red al conectar con SIDGAD (${code}) en ${ctx.url}.`,
      retryable: true,
      failover: true,
    });
  }

  if (code && /SELF_SIGNED|CERT_|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER|ERR_TLS|EPROTO/i.test(code)) {
    return new SidgadEgressError({
      ...common,
      kind: 'tls',
      message: `Error TLS al conectar con SIDGAD (${code}) en ${ctx.url}. No se reintenta.`,
      retryable: false,
      failover: false,
    });
  }

  if (
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'EPIPE' ||
    code === 'EHOSTUNREACH' ||
    code === 'ENETUNREACH' ||
    code === 'ENETDOWN' ||
    code === 'EADDRNOTAVAIL' ||
    code === 'UND_ERR_SOCKET' ||
    errorNameOf(err) === 'AbortError' ||
    err instanceof TypeError
  ) {
    return new SidgadEgressError({
      ...common,
      kind: 'network',
      message: `Error de red al conectar con SIDGAD${code ? ` (${code})` : ''} en ${ctx.url}.`,
      retryable: true,
      failover: true,
    });
  }

  return new SidgadEgressError({
    ...common,
    kind: 'network',
    message: `Fallo de transporte inesperado al conectar con SIDGAD en ${ctx.url}: ${err instanceof Error ? err.message : String(err)}`,
    retryable: true,
    failover: true,
  });
}

/** Solo los fallos de TRANSPORTE permiten probar otra ruta. */
export function isFailoverEligible(error: SidgadEgressError): boolean {
  return error.failover && (error.kind === 'dns' || error.kind === 'network' || error.kind === 'timeout');
}

/** Backoff exponencial con jitter ±20%, acotado. */
export function computeBackoffMs(
  attempt: number,
  baseMs: number,
  maxMs: number,
  random: () => number = Math.random
): number {
  const safeAttempt = Math.max(1, attempt);
  const exponential = Math.min(maxMs, baseMs * 2 ** (safeAttempt - 1));
  const jitter = 0.2;
  const factor = 1 - jitter + random() * jitter * 2;
  return Math.max(0, Math.round(Math.min(maxMs, exponential * factor)));
}

/** Retry-After en segundos o fecha HTTP. Devuelve milisegundos. */
export function parseRetryAfter(value: string | null | undefined, now: number = Date.now()): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);

  const date = Date.parse(trimmed);
  if (!Number.isNaN(date)) return Math.max(0, date - now);
  return undefined;
}

/** Atajo para errores de configuración (no son de red y nunca se reintentan). */
export function configError(message: string, route: EgressRouteKind = 'direct', portal = 'unknown'): SidgadEgressError {
  return new SidgadEgressError({
    kind: 'config',
    message,
    route,
    portal,
    url: '',
    retryable: false,
    failover: false,
  });
}

/**
 * Tipos de la capa de salida (egress) hacia SIDGAD.
 *
 * La idea es que el scraper no sepa POR DÓNDE sale: `SidgadClient` construye
 * una petición lógica (método, URL, portal, endpoint) y esta capa decide la
 * ruta configurada, aplica reintentos, circuit breaker y métricas.
 */

export type EgressRouteKind = 'direct' | 'cloudflare' | 'secondary-ip';

export type SidgadFailureKind =
  | 'dns'
  | 'network'
  | 'timeout'
  | 'tls'
  | 'http'
  | 'forbidden'
  | 'rate_limited'
  | 'server'
  | 'client'
  | 'response_too_large'
  | 'config'
  | 'paused';

export interface EgressRouteConfig {
  kind: EgressRouteKind;
  /** La ruta se puede usar en este despliegue. */
  enabled: boolean;
  /**
   * El operador declara que SIDGAD ha autorizado expresamente esta ruta.
   * Es un guardrail: sin esto, la ruta no se usa ni aunque esté configurada.
   */
  authorized: boolean;
  /** URL base del Worker (sin barra final). */
  workerUrl?: string;
  /** Secreto compartido con el Worker. Nunca se loguea. */
  workerSecret?: string;
  /** IP de origen de la segunda salida (solo ruta 'secondary-ip'). */
  sourceIp?: string;
}

export interface EgressConfig {
  primary: EgressRouteKind;
  /** Rutas de respaldo, en orden. Solo se usan ante fallos de transporte. */
  fallbacks: EgressRouteKind[];
  routes: Record<EgressRouteKind, EgressRouteConfig>;
  retries: number;
  retryBaseMs: number;
  retryMaxMs: number;
  timeoutMs: number;
  maxRetryAfterMs: number;
  circuitFailureThreshold: number;
  circuitCooldownMs: number;
  alertThrottleMs: number;
  /**
   * Pausa por ruta y host tras un 403/429 (sidgad-guard): 5 min que se
   * duplican hasta 30. Sin ella, cada ciclo volvía a pedir y a llevarse otro
   * 403, que es lo que alarga un bloqueo. Ausente o false = sin pausa.
   */
  pauseOnBlock?: boolean;
  /** Separación mínima entre peticiones a un mismo host por la misma ruta (ms). */
  minGapMs?: number;
}

export interface EgressRequest {
  method: 'GET' | 'POST';
  /** URL directa completa (la que se usaría sin intermediario). */
  url: string;
  /** Prefijo del portal SIDGAD (`rfep`, `worldskate`, `fecapa`...). */
  portal: string;
  /** Endpoint relativo al portal; null si la URL es absoluta. */
  endpointPath: string | null;
  headers: Record<string, string>;
  body?: string;
  /** Si se omite, se usa el timeout de la configuración de egress. */
  timeoutMs?: number;
  /** Total de intentos (1 = sin reintentos). */
  retries?: number;
  retryBaseMs?: number;
}

export interface EgressResponse {
  status: number;
  body: string;
  setCookie: string[];
  retryAfter: string | null;
  route: EgressRouteKind;
  latencyMs: number;
  url: string;
}

/** Respuesta cruda de un transporte, sin clasificar el status HTTP. */
export interface RawEgressResponse {
  status: number;
  body: string;
  setCookie: string[];
  retryAfter: string | null;
  latencyMs: number;
  url: string;
  /** Código propio del Worker para distinguir sus errores de los de SIDGAD. */
  errorCode?: string;
}

export interface EgressTransport {
  execute(request: EgressRequest, route: EgressRouteConfig): Promise<RawEgressResponse>;
}

export interface CircuitSnapshot {
  state: 'closed' | 'open' | 'half-open';
  failures: number;
  openedAt: number | null;
  cooldownRemainingMs: number;
}

export interface EgressMetricEntry {
  route: EgressRouteKind;
  portal: string;
  requests: number;
  successes: number;
  failures: number;
  retries: number;
  failovers: number;
  circuitRejects: number;
  circuitOpens: number;
  recoveries: number;
  consecutiveFailures: number;
  lastErrorKind?: SidgadFailureKind;
  lastStatus?: number;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastRecoveredAt?: string;
  latency: {
    count: number;
    lastMs: number;
    avgMs: number;
    p95Ms: number;
  };
}

/**
 * Configuración de la salida SIDGAD, resuelta desde el entorno.
 *
 * Regla de oro: una ruta alternativa SOLO se usa si está a la vez:
 *   1. `ENABLED=1`
 *   2. `AUTHORIZED=1`  ← declaración explícita de que SIDGAD la autorizó
 *   3. completamente configurada (URL+secreto, o IP de origen)
 *
 * Si algo está activado a medias, el proceso falla al arrancar con un mensaje
 * claro. Preferimos un error visible a un fallback silencioso a una ruta no
 * autorizada.
 */
import { isIP } from 'node:net';
import type { EgressConfig, EgressRouteConfig, EgressRouteKind } from './types.js';

const ROUTE_KINDS: readonly EgressRouteKind[] = ['direct', 'cloudflare', 'secondary-ip'];
const MIN_WORKER_SECRET_LENGTH = 32;

type Env = Record<string, string | undefined>;

function parseBool(env: Env, key: string, fallback = false): boolean {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = raw.trim().toLowerCase();
  if (value === '1' || value === 'true' || value === 'yes' || value === 'on') return true;
  if (value === '0' || value === 'false' || value === 'no' || value === 'off') return false;
  throw new Error(`${key}="${raw}" no es un booleano válido (usa 1/0, true/false).`);
}

function parsePositiveInt(env: Env, key: string, fallback: number, min = 1): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`${key}="${raw}" no es un entero válido (mínimo ${min}).`);
  }
  return value;
}

function parseRouteKind(value: string, key: string): EgressRouteKind {
  const normalized = value.trim().toLowerCase();
  if (!ROUTE_KINDS.includes(normalized as EgressRouteKind)) {
    throw new Error(`${key}="${value}" no es una ruta válida (${ROUTE_KINDS.join(', ')}).`);
  }
  return normalized as EgressRouteKind;
}

function parseFallbacks(env: Env, primary: EgressRouteKind): EgressRouteKind[] {
  const raw = env['SIDGAD_EGRESS_FALLBACKS'];
  if (!raw || raw.trim() === '') return [];

  const parsed = raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => parseRouteKind(part, 'SIDGAD_EGRESS_FALLBACKS'));

  if (new Set(parsed).size !== parsed.length) {
    throw new Error('SIDGAD_EGRESS_FALLBACKS contiene rutas repetidas.');
  }
  if (parsed.includes(primary)) {
    throw new Error('SIDGAD_EGRESS_FALLBACKS no puede incluir la ruta primaria.');
  }
  return parsed;
}

function requireRouteUsable(route: EgressRouteConfig, source: string): void {
  if (!route.enabled) {
    throw new Error(`${source}: la ruta "${route.kind}" no está habilitada (${flagName(route.kind, 'ENABLED')}=1).`);
  }
  if (!route.authorized) {
    throw new Error(
      `${source}: la ruta "${route.kind}" no está autorizada. ` +
        `SIDGAD debe autorizarla expresamente antes de activar ${flagName(route.kind, 'AUTHORIZED')}=1.`
    );
  }
  if (route.kind === 'cloudflare' && (!route.workerUrl || !route.workerSecret)) {
    throw new Error(
      `${source}: la ruta "cloudflare" requiere SIDGAD_EGRESS_WORKER_URL y SIDGAD_EGRESS_WORKER_SECRET.`
    );
  }
  if (route.kind === 'secondary-ip' && !route.sourceIp) {
    throw new Error(
      `${source}: la ruta "secondary-ip" requiere SIDGAD_EGRESS_SECONDARY_SOURCE_IP.`
    );
  }
}

function flagName(kind: EgressRouteKind, suffix: 'ENABLED' | 'AUTHORIZED'): string {
  if (kind === 'cloudflare') return `SIDGAD_EGRESS_CLOUDFLARE_${suffix}`;
  if (kind === 'secondary-ip') return `SIDGAD_EGRESS_SECONDARY_IP_${suffix}`;
  return 'SIDGAD_EGRESS_DIRECT';
}

function parseWorkerUrl(raw: string | undefined): string | undefined {
  if (!raw || raw.trim() === '') return undefined;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error(`SIDGAD_EGRESS_WORKER_URL="${raw}" no es una URL válida.`);
  }
  if (url.protocol !== 'https:') {
    throw new Error('SIDGAD_EGRESS_WORKER_URL debe usar HTTPS.');
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error('SIDGAD_EGRESS_WORKER_URL debe ser solo el origen (sin path, query ni hash).');
  }
  return url.origin;
}

function parseSourceIp(raw: string | undefined): string | undefined {
  if (!raw || raw.trim() === '') return undefined;
  const value = raw.trim();
  if (isIP(value) === 0) {
    throw new Error(`SIDGAD_EGRESS_SECONDARY_SOURCE_IP="${raw}" no es una IP válida.`);
  }
  return value;
}

export function loadEgressConfig(env: Env = process.env): EgressConfig {
  const primary = parseRouteKind(env['SIDGAD_EGRESS_PRIMARY'] ?? 'direct', 'SIDGAD_EGRESS_PRIMARY');
  const fallbacks = parseFallbacks(env, primary);

  const workerUrl = parseWorkerUrl(env['SIDGAD_EGRESS_WORKER_URL']);
  const workerSecret = env['SIDGAD_EGRESS_WORKER_SECRET']?.trim() || undefined;
  if (workerSecret !== undefined && workerSecret.length < MIN_WORKER_SECRET_LENGTH) {
    throw new Error(
      `SIDGAD_EGRESS_WORKER_SECRET debe tener al menos ${MIN_WORKER_SECRET_LENGTH} caracteres.`
    );
  }

  const sourceIp = parseSourceIp(env['SIDGAD_EGRESS_SECONDARY_SOURCE_IP']);
  const routes: Record<EgressRouteKind, EgressRouteConfig> = {
    direct: { kind: 'direct', enabled: true, authorized: true },
    cloudflare: {
      kind: 'cloudflare',
      enabled: parseBool(env, 'SIDGAD_EGRESS_CLOUDFLARE_ENABLED'),
      authorized: parseBool(env, 'SIDGAD_EGRESS_CLOUDFLARE_AUTHORIZED'),
      ...(workerUrl ? { workerUrl } : {}),
      ...(workerSecret ? { workerSecret } : {}),
    },
    'secondary-ip': {
      kind: 'secondary-ip',
      enabled: parseBool(env, 'SIDGAD_EGRESS_SECONDARY_IP_ENABLED'),
      authorized: parseBool(env, 'SIDGAD_EGRESS_SECONDARY_IP_AUTHORIZED'),
      ...(sourceIp ? { sourceIp } : {}),
    },
  };

  requireRouteUsable(routes[primary], 'SIDGAD_EGRESS_PRIMARY');
  for (const fallback of fallbacks) {
    requireRouteUsable(routes[fallback], 'SIDGAD_EGRESS_FALLBACKS');
  }
  // Una ruta habilitada pero no seleccionada también debe estar completa:
  // "habilitada" significa que el operador cree que puede usarse.
  for (const route of Object.values(routes)) {
    if (route.enabled) requireRouteUsable(route, `Configuración de la ruta "${route.kind}"`);
  }

  const timeoutDefault = parsePositiveInt(
    { SIDGAD_EGRESS_TIMEOUT_MS: env['SCRAPER_REQUEST_TIMEOUT_MS'] },
    'SIDGAD_EGRESS_TIMEOUT_MS',
    30_000
  );

  return {
    primary,
    fallbacks,
    routes,
    retries: parsePositiveInt(env, 'SIDGAD_EGRESS_RETRIES', 3),
    retryBaseMs: parsePositiveInt(
      { SIDGAD_EGRESS_RETRY_BASE_MS: env['SCRAPER_RETRY_DELAY_MS'] },
      'SIDGAD_EGRESS_RETRY_BASE_MS',
      2_000
    ),
    retryMaxMs: parsePositiveInt(env, 'SIDGAD_EGRESS_RETRY_MAX_MS', 30_000),
    timeoutMs: parsePositiveInt(env, 'SIDGAD_EGRESS_TIMEOUT_MS', timeoutDefault),
    maxRetryAfterMs: parsePositiveInt(env, 'SIDGAD_EGRESS_MAX_RETRY_AFTER_MS', 60_000),
    circuitFailureThreshold: parsePositiveInt(env, 'SIDGAD_EGRESS_CIRCUIT_FAILURES', 5),
    circuitCooldownMs: parsePositiveInt(env, 'SIDGAD_EGRESS_CIRCUIT_COOLDOWN_MS', 60_000),
    alertThrottleMs: parsePositiveInt(env, 'SIDGAD_EGRESS_ALERT_THROTTLE_MS', 600_000),
    pauseOnBlock: env['SIDGAD_EGRESS_PAUSE_ON_BLOCK'] !== '0',
    minGapMs: parsePositiveInt(env, 'SIDGAD_EGRESS_MIN_GAP_MS', 400),
  };
}

/** Vista segura para logs: nunca incluye secretos ni la URL completa. */
export function describeEgressConfig(config: EgressConfig): Record<string, unknown> {
  return {
    primary: config.primary,
    fallbacks: config.fallbacks,
    routes: {
      direct: { enabled: config.routes.direct.enabled, authorized: config.routes.direct.authorized },
      cloudflare: {
        enabled: config.routes.cloudflare.enabled,
        authorized: config.routes.cloudflare.authorized,
        configured: Boolean(config.routes.cloudflare.workerUrl && config.routes.cloudflare.workerSecret),
      },
      'secondary-ip': {
        enabled: config.routes['secondary-ip'].enabled,
        authorized: config.routes['secondary-ip'].authorized,
        configured: Boolean(config.routes['secondary-ip'].sourceIp),
      },
    },
    retries: config.retries,
    timeoutMs: config.timeoutMs,
    circuitFailureThreshold: config.circuitFailureThreshold,
    circuitCooldownMs: config.circuitCooldownMs,
  };
}

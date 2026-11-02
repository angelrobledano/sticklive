/**
 * Cloudflare Worker: intermediario HTTP para SIDGAD.
 *
 * Seguridad:
 *   · Solo acepta GET/POST a `/{portal}/{endpoint}.php` con portal en lista
 *     blanca. No es un proxy abierto: no acepta URLs absolutas, `..`, query
 *     strings ni otros métodos.
 *   · Exige firma HMAC-SHA256 con timestamp (ventana de reloj corta). El
 *     secreto vive en `wrangler secret`, nunca en el repo.
 *   · Reenvía solo cabeceras necesarias (incluida la cookie de sesión de
 *     SIDGAD); no reenvía `authorization`, `cf-*` ni cabeceras internas.
 *   · No registra cookies, cuerpos ni la firma.
 *
 * Límites: el plan gratuito de Workers da 100.000 peticiones/día y 10 ms de
 * CPU por petición. La verificación HMAC y el reenvío caben de sobra; el
 * volumen real de Stick Live es de miles de peticiones al día.
 *
 * Este módulo es deliberadamente autocontenido (solo Web APIs) para que
 * `wrangler` lo pueda empaquetar sin dependencias del monorepo.
 */

export interface WorkerEnv {
  SIDGAD_WORKER_SECRET?: string;
  SIDGAD_UPSTREAM_ORIGIN?: string;
  SIDGAD_ALLOWED_PORTALS?: string;
  SIDGAD_MAX_BODY_BYTES?: string;
  SIDGAD_CLOCK_SKEW_SECONDS?: string;
  SIDGAD_REQUEST_TIMEOUT_MS?: string;
}

const DEFAULT_UPSTREAM_ORIGIN = 'https://www.server2.sidgad.es';
const DEFAULT_ALLOWED_PORTALS = [
  'rfep',
  'worldskate',
  'fecapa',
  'fmp',
  'fap',
  'fpcv',
  'fnp',
  'fpcyl',
  'fgpatinaxe',
  'fisr',
];
const DEFAULT_MAX_BODY_BYTES = 64 * 1024;
const DEFAULT_CLOCK_SKEW_SECONDS = 300;
const DEFAULT_TIMEOUT_MS = 25_000;

const FORWARDED_HEADERS = new Set([
  'accept',
  'accept-language',
  'content-type',
  'cookie',
  'origin',
  'referer',
  'user-agent',
  'x-requested-with',
  'sec-ch-ua',
  'sec-ch-ua-mobile',
  'sec-ch-ua-platform',
  'sec-fetch-dest',
  'sec-fetch-mode',
  'sec-fetch-site',
]);

const PATH_RE = /^\/([a-z0-9]+)\/([A-Za-z0-9_.-]+\.php)$/;
const HEX_RE = /^[0-9a-f]{64}$/i;

type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface WorkerConfig {
  secret: string;
  upstreamOrigin: string;
  allowedPortals: Set<string>;
  maxBodyBytes: number;
  clockSkewSeconds: number;
  timeoutMs: number;
}

function intFromEnv(raw: string | undefined, fallback: number, min = 1): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= min ? value : fallback;
}

function resolveConfig(env: WorkerEnv): WorkerConfig | null {
  const secret = env.SIDGAD_WORKER_SECRET?.trim();
  if (!secret || secret.length < 32) return null;

  const origin = (env.SIDGAD_UPSTREAM_ORIGIN ?? DEFAULT_UPSTREAM_ORIGIN).replace(/\/$/, '');
  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    return null;
  }
  if (parsedOrigin.protocol !== 'https:' || parsedOrigin.pathname !== '/') return null;

  const portals = (env.SIDGAD_ALLOWED_PORTALS ?? DEFAULT_ALLOWED_PORTALS.join(','))
    .split(',')
    .map((portal) => portal.trim())
    .filter(Boolean);

  return {
    secret,
    upstreamOrigin: parsedOrigin.origin,
    allowedPortals: new Set(portals),
    maxBodyBytes: intFromEnv(env.SIDGAD_MAX_BODY_BYTES, DEFAULT_MAX_BODY_BYTES),
    clockSkewSeconds: intFromEnv(env.SIDGAD_CLOCK_SKEW_SECONDS, DEFAULT_CLOCK_SKEW_SECONDS, 1),
    timeoutMs: intFromEnv(env.SIDGAD_REQUEST_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
  };
}

function json(status: number, body: Record<string, unknown>, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders,
    },
  });
}

function errorResponse(status: number, code: string, requestId: string): Response {
  return json(status, { error: code, requestId }, { 'x-sticklive-error': code, 'x-sticklive-request-id': requestId });
}

function logEvent(event: Record<string, unknown>): void {
  // Cloudflare captura esto en Workers Logs / `wrangler tail`.
  console.log(JSON.stringify({ event: 'sidgad_egress', ...event }));
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> | null {
  if (!HEX_RE.test(hex)) return null;
  const bytes = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function verifySignature(input: {
  secret: string;
  timestamp: string;
  method: string;
  path: string;
  body: ArrayBuffer;
  signature: string;
}): Promise<boolean> {
  const signatureBytes = hexToBytes(input.signature);
  if (!signatureBytes) return false;

  const bodyHash = await sha256Hex(input.body);
  const canonical = `${input.timestamp}\n${input.method}\n${input.path}\n${bodyHash}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(input.secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );

  return crypto.subtle.verify(
    'HMAC',
    key,
    signatureBytes,
    new TextEncoder().encode(canonical)
  );
}

function readSetCookie(headers: Headers): string[] {
  const withCookies = headers as Headers & { getSetCookie?: () => string[] };
  try {
    if (typeof withCookies.getSetCookie === 'function') return withCookies.getSetCookie();
  } catch {
    // Fallback abajo.
  }
  const raw = headers.get('set-cookie');
  return raw ? [raw] : [];
}

function isTimeout(error: unknown): boolean {
  return (
    (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) ||
    (typeof error === 'object' && error !== null && (error as { name?: string }).name === 'TimeoutError')
  );
}

export function createWorkerHandler(env: WorkerEnv, fetchImpl: FetchImpl = fetch) {
  return async function handler(request: Request): Promise<Response> {
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    const config = resolveConfig(env);

    if (!config) {
      logEvent({ requestId, outcome: 'worker_misconfigured', durationMs: Date.now() - startedAt });
      return errorResponse(500, 'worker_misconfigured', requestId);
    }

    const method = request.method.toUpperCase();
    if (method !== 'GET' && method !== 'POST') {
      return errorResponse(405, 'method_not_allowed', requestId);
    }

    const url = new URL(request.url);
    if (url.search) {
      return errorResponse(400, 'query_not_allowed', requestId);
    }

    const match = PATH_RE.exec(url.pathname);
    if (!match) {
      return errorResponse(400, 'bad_path', requestId);
    }
    const portal = match[1]!;
    const endpoint = match[2]!;

    if (!config.allowedPortals.has(portal)) {
      logEvent({ requestId, portal, outcome: 'portal_not_allowed', durationMs: Date.now() - startedAt });
      return errorResponse(403, 'portal_not_allowed', requestId);
    }

    // Cuerpo (solo POST). El límite evita que el Worker haga de buffer gigante.
    let body: ArrayBuffer = new ArrayBuffer(0);
    if (method === 'POST') {
      const contentLength = Number(request.headers.get('content-length') ?? '0');
      if (Number.isFinite(contentLength) && contentLength > config.maxBodyBytes) {
        return errorResponse(413, 'payload_too_large', requestId);
      }
      body = await request.arrayBuffer();
      if (body.byteLength > config.maxBodyBytes) {
        return errorResponse(413, 'payload_too_large', requestId);
      }
      const contentType = request.headers.get('content-type') ?? '';
      if (body.byteLength > 0 && !contentType.toLowerCase().includes('application/x-www-form-urlencoded')) {
        return errorResponse(415, 'unsupported_media_type', requestId);
      }
    }

    // Autenticación HMAC.
    const timestamp = request.headers.get('x-sticklive-timestamp') ?? '';
    const signature = request.headers.get('x-sticklive-signature') ?? '';
    if (!/^\d{1,12}$/.test(timestamp) || !signature) {
      logEvent({ requestId, portal, method, outcome: 'unauthorized_missing', durationMs: Date.now() - startedAt });
      return errorResponse(401, 'unauthorized', requestId);
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const timestampSeconds = Number(timestamp);
    if (Math.abs(nowSeconds - timestampSeconds) > config.clockSkewSeconds) {
      logEvent({ requestId, portal, method, outcome: 'unauthorized_stale', durationMs: Date.now() - startedAt });
      return errorResponse(401, 'unauthorized', requestId);
    }

    const validSignature = await verifySignature({
      secret: config.secret,
      timestamp,
      method,
      path: url.pathname,
      body,
      signature,
    });
    if (!validSignature) {
      logEvent({ requestId, portal, method, outcome: 'unauthorized_signature', durationMs: Date.now() - startedAt });
      return errorResponse(401, 'unauthorized', requestId);
    }

    // Cabeceras que SIDGAD necesita; el resto se descarta.
    const forwardedHeaders = new Headers();
    request.headers.forEach((value, name) => {
      if (FORWARDED_HEADERS.has(name.toLowerCase())) forwardedHeaders.set(name, value);
    });
    forwardedHeaders.delete('host');
    forwardedHeaders.delete('content-length');

    const upstreamUrl = `${config.upstreamOrigin}/${portal}/${endpoint}`;
    const upstreamStarted = Date.now();

    try {
      const response = await fetchImpl(upstreamUrl, {
        method,
        headers: forwardedHeaders,
        ...(method === 'POST' ? { body } : {}),
        signal: AbortSignal.timeout(config.timeoutMs),
      });

      const responseHeaders = new Headers();
      responseHeaders.set('content-type', response.headers.get('content-type') ?? 'text/html; charset=utf-8');
      responseHeaders.set('cache-control', 'no-store');
      responseHeaders.set('x-sticklive-egress', 'cloudflare-worker');
      responseHeaders.set('x-sticklive-request-id', requestId);
      for (const cookie of readSetCookie(response.headers)) {
        responseHeaders.append('set-cookie', cookie);
      }

      logEvent({
        requestId,
        portal,
        endpoint,
        method,
        upstreamStatus: response.status,
        durationMs: Date.now() - upstreamStarted,
        outcome: 'ok',
      });

      // 204/304 no pueden llevar cuerpo; el resto se transmite en streaming.
      const responseBody = response.status === 204 || response.status === 304 ? null : response.body;
      return new Response(responseBody, { status: response.status, headers: responseHeaders });
    } catch (error) {
      const timeout = isTimeout(error);
      logEvent({
        requestId,
        portal,
        endpoint,
        method,
        durationMs: Date.now() - upstreamStarted,
        outcome: timeout ? 'upstream_timeout' : 'upstream_error',
      });
      return errorResponse(timeout ? 504 : 502, timeout ? 'upstream_timeout' : 'upstream_error', requestId);
    }
  };
}

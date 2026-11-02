/**
 * Transporte directo: `fetch` global de Node.
 *
 * Mantiene el comportamiento histórico (incluye redirecciones) pero con
 * timeout que cubre también la lectura del cuerpo, no solo la conexión.
 */
import { classifyTransportError } from './errors.js';
import type { EgressRequest, EgressRouteConfig, EgressTransport, RawEgressResponse } from './types.js';

/** `Headers.getSetCookie()` existe en Node 20+; dejamos un fallback por si acaso. */
export function readSetCookie(headers: Headers): string[] {
  const withCookies = headers as Headers & { getSetCookie?: () => string[] };
  try {
    if (typeof withCookies.getSetCookie === 'function') {
      const cookies = withCookies.getSetCookie();
      if (cookies.length > 0) return cookies;
    }
  } catch {
    // Algunos runtimes no lo implementan; seguimos con el fallback.
  }
  const raw = headers.get('set-cookie');
  return raw ? [raw] : [];
}

export class FetchTransport implements EgressTransport {
  async execute(request: EgressRequest, route: EgressRouteConfig): Promise<RawEgressResponse> {
    const startedAt = Date.now();
    let timedOut = false;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, request.timeoutMs ?? 30_000);

    try {
      const response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        ...(request.method === 'POST' && request.body !== undefined ? { body: request.body } : {}),
        signal: controller.signal,
        redirect: 'follow',
      });

      // El timeout debe cubrir también un cuerpo que se queda a medias.
      const body = await response.text();

      return {
        status: response.status,
        body,
        setCookie: readSetCookie(response.headers),
        retryAfter: response.headers.get('retry-after'),
        latencyMs: Date.now() - startedAt,
        url: response.url || request.url,
      };
    } catch (error) {
      throw classifyTransportError(error, {
        route: route.kind,
        portal: request.portal,
        url: request.url,
        timedOut,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

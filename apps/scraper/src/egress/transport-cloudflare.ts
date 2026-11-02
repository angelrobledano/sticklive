/**
 * Transporte a través del Cloudflare Worker.
 *
 * El Worker recibe `/portal/endpoint.php`, verifica la firma HMAC y reenvía a
 * SIDGAD. El servidor nunca manda la URL de SIDGAD al Worker: manda portal +
 * endpoint, y el Worker los resuelve contra un origen fijo y una lista blanca.
 */
import { configError, classifyTransportError } from './errors.js';
import { buildWorkerPath, signEgressRequest } from './hmac.js';
import { readSetCookie } from './transport-fetch.js';
import type { EgressRequest, EgressRouteConfig, EgressTransport, RawEgressResponse } from './types.js';

export class CloudflareWorkerTransport implements EgressTransport {
  constructor(private readonly now: () => number = Date.now) {}

  async execute(request: EgressRequest, route: EgressRouteConfig): Promise<RawEgressResponse> {
    if (!route.workerUrl || !route.workerSecret) {
      throw configError('Ruta cloudflare sin URL o secreto configurados.', route.kind, request.portal);
    }
    if (!request.endpointPath) {
      throw configError(
        'La ruta cloudflare solo admite endpoints relativos al portal (no URLs absolutas).',
        route.kind,
        request.portal
      );
    }

    let workerPath: string;
    try {
      workerPath = buildWorkerPath(request.portal, request.endpointPath);
    } catch (error) {
      throw configError(
        error instanceof Error ? error.message : String(error),
        route.kind,
        request.portal
      );
    }

    const timestamp = String(Math.floor(this.now() / 1000));
    const signature = signEgressRequest({
      secret: route.workerSecret,
      timestamp,
      method: request.method,
      pathWithQuery: workerPath,
      body: request.body ?? '',
    });

    const headers: Record<string, string> = { ...request.headers };
    delete headers['host'];
    delete headers['Host'];
    headers['x-sticklive-timestamp'] = timestamp;
    headers['x-sticklive-signature'] = signature;

    const url = `${route.workerUrl}${workerPath}`;
    const startedAt = Date.now();
    let timedOut = false;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, request.timeoutMs ?? 30_000);

    try {
      const response = await fetch(url, {
        method: request.method,
        headers,
        ...(request.method === 'POST' && request.body !== undefined ? { body: request.body } : {}),
        signal: controller.signal,
        redirect: 'follow',
      });
      const body = await response.text();
      const workerError = response.headers.get('x-sticklive-error');

      return {
        status: response.status,
        body,
        setCookie: readSetCookie(response.headers),
        retryAfter: response.headers.get('retry-after'),
        latencyMs: Date.now() - startedAt,
        url,
        ...(workerError ? { errorCode: workerError } : {}),
      };
    } catch (error) {
      throw classifyTransportError(error, {
        route: route.kind,
        portal: request.portal,
        url,
        timedOut,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

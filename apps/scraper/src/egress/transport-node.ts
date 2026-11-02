/**
 * Transporte con IP de origen seleccionable (`localAddress`).
 *
 * Se usa `node:https` en vez de `fetch` porque el `fetch` global de Node no
 * permite elegir la IP de origen de la conexión. Es la pieza que hace posible
 * la segunda salida de Hetzner sin depender de un proxy externo.
 *
 * LIMITACIÓN DE DOCKER: `localAddress` solo funciona si la IP adicional está
 * asignada a la interfaz del proceso. En un contenedor con red bridge, la IP
 * del host no está en su namespace. Ver docs/egress-sidgad.md: la vía simple es
 * ejecutar el contenedor `etl` con `network_mode: host` (y Postgres por
 * 127.0.0.1), o asignar la IP a una red macvlan/ipvlan.
 */
import * as http from 'node:http';
import * as https from 'node:https';
import { classifyTransportError, SidgadEgressError } from './errors.js';
import type { EgressRequest, EgressRouteConfig, EgressTransport, RawEgressResponse } from './types.js';

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;

class ResponseTooLargeError extends Error {
  constructor() {
    super('Respuesta de SIDGAD demasiado grande');
    this.name = 'ResponseTooLargeError';
  }
}

export interface NodeRequestTextOptions {
  method: 'GET' | 'POST';
  url: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
  localAddress?: string;
  maxRedirects?: number;
  maxResponseBytes?: number;
}

interface RawNodeResponse {
  status: number;
  body: string;
  setCookie: string[];
  retryAfter: string | null;
  location: string | null;
  url: string;
}

function decodeBody(buffer: Buffer, contentType: string | undefined): string {
  const charset = /charset=([^;]+)/i.exec(contentType ?? '')?.[1]?.trim();
  if (!charset) return buffer.toString('utf8');
  try {
    return new TextDecoder(charset).decode(buffer);
  } catch {
    return buffer.toString('utf8');
  }
}

function normalizeHeader(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

async function requestOnce(
  options: NodeRequestTextOptions,
  url: string,
  method: 'GET' | 'POST',
  body: string | undefined,
  redirectsLeft: number
): Promise<RawNodeResponse> {
  const target = new URL(url);
  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    throw new SidgadEgressError({
      kind: 'config',
      message: `Protocolo no soportado para la segunda salida: ${target.protocol}`,
      route: 'secondary-ip',
      portal: target.hostname,
      url,
      retryable: false,
      failover: false,
    });
  }

  let timedOut = false;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs);

  try {
    const response = await new Promise<RawNodeResponse>((resolve, reject) => {
      const mod = target.protocol === 'https:' ? https : http;
      const headers: Record<string, string> = { ...options.headers };
      delete headers['host'];
      delete headers['Host'];

      if (method === 'POST' && body !== undefined) {
        headers['content-length'] = String(Buffer.byteLength(body));
      } else {
        delete headers['content-length'];
        delete headers['Content-Length'];
      }

      const request = mod.request(
        target,
        {
          method,
          headers,
          signal: controller.signal,
          ...(options.localAddress ? { localAddress: options.localAddress } : {}),
        },
        (res) => {
          const status = res.statusCode ?? 0;
          const location = normalizeHeader(res.headers.location);

          if (REDIRECT_STATUS.has(status) && location && redirectsLeft > 0) {
            // Consumir y cerrar la respuesta antes de seguir la redirección.
            res.resume();
            resolve({
              status,
              body: '',
              setCookie: [],
              retryAfter: null,
              location,
              url,
            });
            return;
          }

          const maxBytes = options.maxResponseBytes ?? DEFAULT_MAX_BYTES;
          const chunks: Buffer[] = [];
          let size = 0;

          res.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > maxBytes) {
              res.destroy(new ResponseTooLargeError());
              return;
            }
            chunks.push(chunk);
          });
          res.on('error', reject);
          res.on('end', () => {
            const rawSetCookie = res.headers['set-cookie'];
            resolve({
              status,
              body: decodeBody(Buffer.concat(chunks), normalizeHeader(res.headers['content-type']) ?? undefined),
              setCookie: Array.isArray(rawSetCookie) ? rawSetCookie : rawSetCookie ? [rawSetCookie] : [],
              retryAfter: normalizeHeader(res.headers['retry-after']),
              location,
              url,
            });
          });
        }
      );

      request.on('error', reject);
      if (method === 'POST' && body !== undefined) request.write(body);
      request.end();
    });

    // Redirección: decidir método/cuerpo y repetir con el mismo localAddress.
    if (REDIRECT_STATUS.has(response.status) && response.location && redirectsLeft > 0) {
      const nextUrl = new URL(response.location, url).toString();
      const nextMethod: 'GET' | 'POST' =
        response.status === 303 || ((response.status === 301 || response.status === 302) && method === 'POST')
          ? 'GET'
          : method;
      return requestOnce(
        options,
        nextUrl,
        nextMethod,
        nextMethod === 'POST' ? body : undefined,
        redirectsLeft - 1
      );
    }

    return response;
  } catch (error) {
    if (error instanceof SidgadEgressError) throw error;
    throw classifyTransportError(error, {
      route: 'secondary-ip',
      portal: target.hostname,
      url,
      timedOut,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Realiza una petición de texto con IP de origen seleccionable. */
export async function nodeRequestText(options: NodeRequestTextOptions): Promise<RawEgressResponse> {
  const startedAt = Date.now();
  const response = await requestOnce(
    options,
    options.url,
    options.method,
    options.body,
    options.maxRedirects ?? DEFAULT_MAX_REDIRECTS
  );

  return {
    status: response.status,
    body: response.body,
    setCookie: response.setCookie,
    retryAfter: response.retryAfter,
    latencyMs: Date.now() - startedAt,
    url: response.url,
  };
}

export class LocalAddressTransport implements EgressTransport {
  async execute(request: EgressRequest, route: EgressRouteConfig): Promise<RawEgressResponse> {
    if (!route.sourceIp) {
      throw new SidgadEgressError({
        kind: 'config',
        message: 'Ruta secondary-ip sin IP de origen configurada.',
        route: route.kind,
        portal: request.portal,
        url: request.url,
        retryable: false,
        failover: false,
      });
    }
    return nodeRequestText({
      method: request.method,
      url: request.url,
      headers: request.headers,
      ...(request.body !== undefined ? { body: request.body } : {}),
      timeoutMs: request.timeoutMs ?? 30_000,
      localAddress: route.sourceIp,
    });
  }
}

/**
 * Núcleo del API client: fetch tipado contra apps/api (Hono) + helpers de error.
 * No exportar `apiFetch` a través del barrel `client.ts`: es de uso interno de la capa.
 */

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000';

/**
 * Error tipado de la capa API. `status` es el código HTTP real, para que las
 * páginas no dependan de parsear el mensaje (frágil ante cambios de formato).
 */
export class ApiError extends Error {
  readonly status: number;
  readonly url: string;
  /** Cuerpo crudo de la respuesta; permite distinguir un 404 del API de uno de infraestructura (#365). */
  readonly body: string;
  constructor(status: number, url: string, body: string) {
    super(`API ${status} - ${url}: ${body}`);
    this.name = 'ApiError';
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit & { next?: { revalidate?: number; tags?: string[] } }
): Promise<T> {
  const url = `${API_URL}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new ApiError(res.status, path, body);
  }
  return res.json() as Promise<T>;
}

/** ¿El cuerpo de un 404 es el JSON de error que devuelve el API (no HTML de proxy/CDN)? */
function isApiJsonBody(body: string): boolean {
  return body.trimStart().startsWith('{');
}

/**
 * True solo si la API respondió 404 de verdad (recurso inexistente).
 * Un fallo de conexión o un 500 NO es un 404: las páginas deben mostrar
 * su error boundary (con reintento) en vez de "no encontrado" — si no,
 * cada reinicio de la API convertía páginas válidas en 404s intermitentes.
 *
 * #365: además, un 404 de INFRAESTRUCTURA (proxy/CDN en mantenimiento o con
 * version-skew, que responde HTML) no es un recurso inexistente. El API contesta
 * sus 404 con cuerpo JSON; si el cuerpo no lo es, se trata como fallo real.
 */
export function isApiNotFound(err: unknown): boolean {
  if (err instanceof ApiError) return err.status === 404 && isApiJsonBody(err.body);
  // Fallback para errores serializados (pierden la clase al cruzar fronteras
  // RSC): mismo criterio, exigiendo el formato exacto `API 404 - /ruta: {json}`.
  if (!(err instanceof Error)) return false;
  const m = /^API 404 - \/[^:]*: ([\s\S]*)$/.exec(err.message);
  return !!m && isApiJsonBody(m[1] ?? '');
}

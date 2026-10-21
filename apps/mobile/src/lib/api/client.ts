import { Platform } from 'react-native';

/**
 * Resuelve la URL por defecto según la plataforma cuando EXPO_PUBLIC_API_URL no está definida:
 * - En Android (emulador): 10.0.2.2 es el alias del host local.
 * - En iOS (simulador) y resto: localhost es el host local.
 */
export function resolveDefaultApiUrl(platform: string): string {
  if (platform === 'android') return 'http://10.0.2.2:3000';
  return 'http://localhost:3000';
}

/**
 * Base del API: única fuente para REST (apiFetch) y para URLs absolutas de
 * imágenes (escudos/fotos se sirven proxied por el API con normalización;
 * ver apps/api/src/routes/team-logo.ts y player-photo.ts).
 */
export const API_URL =
  process.env['EXPO_PUBLIC_API_URL'] ?? resolveDefaultApiUrl(Platform.OS);

/** Base de la web para abrir en el navegador del sistema (compra premium). */
export const WEB_URL = process.env['EXPO_PUBLIC_WEB_URL'] ?? 'https://sticklive.eu';

/**
 * Página de la web donde ocurre la compra premium (Stripe): hoy vive en
 * Ajustes (PremiumBanner). Una landing /premium dedicada es mejora futura
 * de la web — no construir aquí una URL que aún no existe.
 */
export function buildWebPremiumUrl(webBase: string, locale: string): string {
  return `${webBase.replace(/\/$/, '')}/${locale}/settings`;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(`api ${status}: ${code}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

interface Options {
  token?: string | null;
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

// Sin timeout por defecto: los retries los gestiona TanStack Query; reconsiderar
// AbortSignal.any si se observa algún colgado.
export async function apiFetch<T>(path: string, opts: Options = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  } catch (err) {
    // La cancelación del llamador no es un fallo de red: se propaga tal cual.
    if (err instanceof Error && err.name === 'AbortError') throw err;
    throw new ApiError(0, 'network');
  }

  if (!res.ok) {
    const envelope = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(res.status, typeof envelope.error === 'string' ? envelope.error : `http_${res.status}`);
  }
  return (await res.json()) as T;
}

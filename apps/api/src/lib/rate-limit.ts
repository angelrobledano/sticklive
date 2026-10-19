/**
 * Rate limiting en memoria (suficiente para un solo nodo / un contenedor).
 *
 * Si la API escala a varios nodos, sustituir el store por Redis manteniendo
 * la misma firma. Limita por (ruta + IP) en ventanas fijas.
 */
import type { Context, Next } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';

interface Bucket {
  count: number;
  resetAt: number;
}

const store = new Map<string, Bucket>();

// Limpieza periódica para no acumular buckets de IPs que ya no vuelven.
const CLEANUP_MS = 10 * 60_000;
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of store) if (b.resetAt <= now) store.delete(k);
}, CLEANUP_MS).unref?.();

export function clientIp(c: Context): string {
  // Los proxies de confianza (Caddy) fijan o AÑADEN la IP real al FINAL del
  // X-Forwarded-For: las entradas previas las controla el cliente y son
  // falsificables. Tomamos la ÚLTIMA, no la primera, para que el límite por IP
  // del SSE y el rate-limit REST no se puedan evadir (#372).
  const xff = c.req.header('x-forwarded-for');
  if (xff) {
    const parts = xff.split(',').map((p) => p.trim()).filter(Boolean);
    const last = parts[parts.length - 1];
    if (last) return last;
  }
  // Sin XFF fiable, la IP de la conexión TCP es el dato menos falsificable.
  try {
    const remote = getConnInfo(c).remote.address;
    if (remote) return remote;
  } catch {
    // Contexto sin información de conexión (p. ej. tests o runtime no-Node).
  }
  // Último recurso: solo lo fía un proxy que fije la cabecera.
  return c.req.header('x-real-ip')?.trim() || 'unknown';
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/**
 * Consume una unidad de una clave arbitraria. Es el núcleo compartido por
 * `rateLimit` y `rateLimitBy`; también sirve para limitar dentro de un handler
 * cuando la clave solo se conoce tras parsear el body (p. ej. el email de un
 * magic link o el deviceId de una suscripción push). Devuelve si la petición
 * pasa y cuántos segundos esperar si no.
 */
export function hitRateLimit(key: string, max: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const b = store.get(key);
  if (!b || b.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (b.count >= max) {
    return { allowed: false, retryAfterSeconds: Math.ceil((b.resetAt - now) / 1000) };
  }
  b.count++;
  return { allowed: true, retryAfterSeconds: 0 };
}

/**
 * Middleware de rate limit por (ruta + IP).
 * @param max      peticiones permitidas por ventana
 * @param windowMs tamaño de la ventana en ms (por defecto 60 s)
 * @param keyFn    clave extra opcional (p. ej. el email) para limitar más fino
 */
export function rateLimit(
  max: number,
  windowMs = 60_000,
  keyFn?: (c: Context) => string | Promise<string>,
  skipIf?: (c: Context) => boolean,
) {
  return async (c: Context, next: Next) => {
    if (skipIf?.(c)) return next();
    const extra = keyFn ? `:${await keyFn(c)}` : '';
    const key = `${c.req.path}:${clientIp(c)}${extra}`;
    const r = hitRateLimit(key, max, windowMs);
    if (!r.allowed) {
      c.header('Retry-After', String(r.retryAfterSeconds));
      return c.json({ error: 'rate_limited', retryAfterSeconds: r.retryAfterSeconds }, 429);
    }
    await next();
  };
}

/**
 * Middleware de rate limit por una clave propia (p. ej. SOLO el email), en vez
 * de la IP. Complementa a `rateLimit`: hace falta un cubo por email para cortar
 * el abuso con IPs rotadas (#307). `keyFn` puede leer el body (Hono lo cachea).
 */
export function rateLimitBy(
  max: number,
  windowMs: number,
  keyFn: (c: Context) => string | Promise<string>
) {
  return async (c: Context, next: Next) => {
    let keyValue: string;
    try {
      keyValue = await keyFn(c);
    } catch {
      keyValue = 'unknown';
    }
    const r = hitRateLimit(`${c.req.path}:by:${keyValue}`, max, windowMs);
    if (!r.allowed) {
      c.header('Retry-After', String(r.retryAfterSeconds));
      return c.json({ error: 'rate_limited', retryAfterSeconds: r.retryAfterSeconds }, 429);
    }
    await next();
  };
}

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

/**
 * Middleware de rate limit.
 * @param max      peticiones permitidas por ventana
 * @param windowMs tamaño de la ventana en ms (por defecto 60 s)
 * @param keyFn    clave extra opcional (p. ej. el email) para limitar más fino
 */
export function rateLimit(
  max: number,
  windowMs = 60_000,
  keyFn?: (c: Context) => string
) {
  return async (c: Context, next: Next) => {
    const extra = keyFn ? `:${keyFn(c)}` : '';
    const key = `${c.req.path}:${clientIp(c)}${extra}`;
    const now = Date.now();
    const b = store.get(key);

    if (!b || b.resetAt <= now) {
      store.set(key, { count: 1, resetAt: now + windowMs });
    } else if (b.count >= max) {
      const retry = Math.ceil((b.resetAt - now) / 1000);
      c.header('Retry-After', String(retry));
      return c.json({ error: 'rate_limited', retryAfterSeconds: retry }, 429);
    } else {
      b.count++;
    }
    await next();
  };
}

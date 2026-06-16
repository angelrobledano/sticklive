/**
 * Rate limiting en memoria (suficiente para un solo nodo / un contenedor).
 *
 * Si la API escala a varios nodos, sustituir el store por Redis manteniendo
 * la misma firma. Limita por (ruta + IP) en ventanas fijas.
 */
import type { Context, Next } from 'hono';

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

function clientIp(c: Context): string {
  // Caddy/Nginx ponen la IP real en X-Forwarded-For (primer valor).
  const xff = c.req.header('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  return c.req.header('x-real-ip') ?? 'unknown';
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

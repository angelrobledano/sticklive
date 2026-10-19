import type { Context, Next } from 'hono';
import { timingSafeEqual } from 'node:crypto';
import { logger } from '@sports/logger';
import { clientIp, hitRateLimit } from './rate-limit.js';
import { isUuid } from './uuid.js';

/**
 * Guardia anti-scraping de las lecturas públicas (paquete A).
 *
 * La API no puede distinguir de forma fiable un navegador de un scraper: el
 * cliente web es público y cualquier token embebido se puede extraer. Este
 * guardia no promete bloqueo absoluto; encarece el scraping masivo y lo hace
 * visible con tres señales independientes:
 *
 *   1. Cuota global por IP (todas las rutas de datos juntas), no por ruta: el
 *      límite por ruta se podía multiplicar recorriendo endpoints.
 *   2. Cuota diaria por IP: corta el abuso sostenido desde una misma IP.
 *   3. Detección de ENUMERACIÓN: muchas entidades distintas (partidos, equipos,
 *      temporadas, jugadores) desde una IP en una ventana corta. Es la señal
 *      que mejor distingue "usuario navegando" de "script recorriendo el
 *      catálogo", aunque el número de peticiones sea bajo.
 *
 * Además limita la CONCURRENCIA por IP para que un scraper paralelo no acapare
 * el proceso. Todo es en memoria (un solo nodo), igual que `rate-limit.ts`.
 *
 * Los crawlers declarados (Googlebot, Bingbot…) quedan exentos SOLO de la
 * detección de enumeración, para no romper el SEO. Siguen sujetos a cuotas y
 * concurrencia. El User-Agent es falsificable: es una señal, no autenticación.
 */

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

/** Presupuesto global de lecturas por IP y minuto. */
export const READ_GLOBAL_MAX = intEnv('READ_GLOBAL_MAX', 600);
export const READ_GLOBAL_WINDOW_MS = intEnv('READ_GLOBAL_WINDOW_MS', MINUTE_MS);
/** Presupuesto diario por IP (ventana móvil desde la primera petición). */
export const READ_DAILY_MAX = intEnv('READ_DAILY_MAX', 50_000);
export const READ_DAILY_WINDOW_MS = intEnv('READ_DAILY_WINDOW_MS', DAY_MS);
/** Peticiones de lectura simultáneas por IP. */
export const READ_CONCURRENCY_MAX = intEnv('READ_CONCURRENCY_MAX', 8);
/** Ventana y umbral de entidades distintas para detectar enumeración. */
export const ENUM_WINDOW_MS = intEnv('ENUM_WINDOW_MS', 10 * MINUTE_MS);
export const ENUM_DISTINCT_MAX = intEnv('ENUM_DISTINCT_MAX', 300);
/** Duración del bloqueo temporal al detectar enumeración. */
export const ENUM_BLOCK_MS = intEnv('ENUM_BLOCK_MS', 15 * MINUTE_MS);

/**
 * Rutas de DATOS que entran en el presupuesto global. Se excluyen a propósito:
 *  · `/matches/:id/stream` (SSE: tiene su propio límite de conexiones),
 *  · imágenes (`/teams/:id/logo`, `/players/:id/photo`),
 *  · health, auth, push, pagos y admin (tienen sus propias reglas).
 */
const METERED_PATH_RE = [
  /^\/competitions$/,
  /^\/competitions\/[^/]+\/seasons$/,
  /^\/seasons\/[^/]+\/(?:overview|stats|insights|matches|standings)$/,
  /^\/matches\/[^/]+$/,
  /^\/teams\/[^/]+(?:\/recent)?$/,
  /^\/players\/[^/]+(?:\/insights)?$/,
  /^\/search$/,
  /^\/meta\/sitemap$/,
];

export function isMeteredReadPath(method: string, path: string): boolean {
  if (method !== 'GET') return false;
  return METERED_PATH_RE.some((re) => re.test(path));
}

export type EntityKind = 'match' | 'team' | 'player' | 'season';

export interface EntityRef {
  kind: EntityKind;
  id: string;
}

/**
 * Extrae la entidad de la ruta para contar cuántas distintas pide una IP.
 * Solo acepta UUIDs válidos: así un bot que inventa rutas no infla el tracker.
 */
export function entityRefFromPath(path: string): EntityRef | null {
  const match = /^\/(matches|teams|players|seasons)\/([^/]+)/.exec(path);
  if (!match) return null;
  const id = match[2]!;
  if (!isUuid(id)) return null;
  const kind = match[1] === 'matches' ? 'match'
    : match[1] === 'teams' ? 'team'
    : match[1] === 'players' ? 'player'
    : 'season';
  return { kind, id };
}

/**
 * Crawlers declarados. Se eximen de la detección de enumeración para que
 * Google/Bing puedan recorrer el catálogo; el User-Agent es falsificable, así
 * que un scraper puede imitarlo, pero seguirá sujeto a cuotas y concurrencia.
 */
const CRAWLER_RE =
  /googlebot|bingbot|duckduckbot|baiduspider|yandex|applebot|slurp|facebookexternalhit|twitterbot|linkedinbot|slackbot|discordbot|whatsapp|telegrambot/i;

export function isCrawlerUserAgent(userAgent: string | undefined): boolean {
  return !!userAgent && CRAWLER_RE.test(userAgent);
}

/**
 * ¿La petición viene del servidor de la web (SSR/build) y no de un usuario?
 *
 * Las lecturas de los Server Components salen de la IP del contenedor `web`,
 * no de la del visitante. Sin esta excepción, una subida de tráfico podría
 * agotar la cuota de esa IP y romper el renderizado de la propia web. El token
 * viaja solo servidor-a-servidor (nunca se hornea en el bundle del navegador).
 * Si no está configurado, no hay bypass.
 */
export function isInternalRequest(c: Context): boolean {
  const expected = process.env['INTERNAL_API_TOKEN'];
  const provided = c.req.header('x-internal-token');
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Límite de peticiones simultáneas por clave (IP). */
export class ConcurrencyLimiter {
  private readonly active = new Map<string, number>();

  constructor(private readonly max: number) {}

  acquire(key: string): boolean {
    const current = this.active.get(key) ?? 0;
    if (current >= this.max) return false;
    this.active.set(key, current + 1);
    return true;
  }

  release(key: string): void {
    const current = this.active.get(key) ?? 0;
    if (current <= 1) this.active.delete(key);
    else this.active.set(key, current - 1);
  }

  count(key: string): number {
    return this.active.get(key) ?? 0;
  }
}

export interface EnumerationVerdict {
  blocked: boolean;
  retryAfterSeconds: number;
  /** Entidades distintas vistas en la ventana (0 si ya estaba bloqueada). */
  distinct: number;
}

/**
 * Cuenta entidades distintas por IP en una ventana deslizante y bloquea
 * temporalmente al superar el umbral. No cuenta peticiones: un scraper que
 * recorre 1.000 partidos hace pocas peticiones por minuto, pero toca muchas
 * entidades distintas.
 */
export class EnumerationTracker {
  private readonly seen = new Map<string, Map<string, number>>();
  private readonly blocked = new Map<string, number>();

  constructor(
    private readonly windowMs: number,
    private readonly maxDistinct: number,
    private readonly blockMs: number,
  ) {}

  check(ip: string, ref: EntityRef, now: number = Date.now()): EnumerationVerdict {
    const until = this.blocked.get(ip);
    if (until !== undefined) {
      if (until > now) {
        return { blocked: true, retryAfterSeconds: Math.ceil((until - now) / 1000), distinct: 0 };
      }
      this.blocked.delete(ip);
    }

    let entries = this.seen.get(ip);
    if (!entries) {
      entries = new Map();
      this.seen.set(ip, entries);
    }

    const cutoff = now - this.windowMs;
    for (const [key, seenAt] of entries) {
      if (seenAt < cutoff) entries.delete(key);
    }
    entries.set(`${ref.kind}:${ref.id}`, now);

    if (entries.size > this.maxDistinct) {
      this.blocked.set(ip, now + this.blockMs);
      this.seen.delete(ip);
      return {
        blocked: true,
        retryAfterSeconds: Math.ceil(this.blockMs / 1000),
        distinct: entries.size,
      };
    }

    return { blocked: false, retryAfterSeconds: 0, distinct: entries.size };
  }

  cleanup(now: number = Date.now()): void {
    for (const [ip, until] of this.blocked) {
      if (until <= now) this.blocked.delete(ip);
    }
    const cutoff = now - this.windowMs;
    for (const [ip, entries] of this.seen) {
      for (const [key, seenAt] of entries) {
        if (seenAt < cutoff) entries.delete(key);
      }
      if (entries.size === 0) this.seen.delete(ip);
    }
  }

  blockedCount(): number {
    return this.blocked.size;
  }

  trackedCount(): number {
    return this.seen.size;
  }
}

const concurrency = new ConcurrencyLimiter(READ_CONCURRENCY_MAX);
const enumeration = new EnumerationTracker(ENUM_WINDOW_MS, ENUM_DISTINCT_MAX, ENUM_BLOCK_MS);

// Limpieza periódica: sin esto, las IPs que dejan de venir quedarían en memoria.
setInterval(() => enumeration.cleanup(), 5 * MINUTE_MS).unref?.();

function tooMany(c: Context, reason: string, retryAfterSeconds: number): Response {
  c.header('Retry-After', String(retryAfterSeconds));
  return c.json({ error: 'rate_limited', reason, retryAfterSeconds }, 429);
}

/**
 * Middleware global. Solo actúa sobre lecturas de datos; el resto pasa sin
 * coste. El orden importa: enumeración → concurrencia → cuotas, para no gastar
 * presupuesto en peticiones que ya van a ser rechazadas.
 */
export async function readGuard(c: Context, next: Next): Promise<Response | void> {
  const path = c.req.path;
  if (!isMeteredReadPath(c.req.method, path)) return next();
  // SSR/build de la web: no compite con las cuotas de los visitantes.
  if (isInternalRequest(c)) return next();

  const ip = clientIp(c);
  const userAgent = c.req.header('user-agent');
  const crawler = isCrawlerUserAgent(userAgent);

  // 1) Enumeración: solo entidades y solo para clientes no declarados como bot.
  const ref = entityRefFromPath(path);
  if (ref && !crawler) {
    const verdict = enumeration.check(ip, ref);
    if (verdict.blocked) {
      logger.warn(
        {
          ip,
          path,
          distinct: verdict.distinct,
          retryAfterSeconds: verdict.retryAfterSeconds,
          userAgent: userAgent?.slice(0, 120),
        },
        '[read-guard] bloqueo temporal por enumeración de entidades',
      );
      return tooMany(c, 'enumeration', verdict.retryAfterSeconds);
    }
  }

  // 2) Concurrencia: un scraper paralelo no debe acaparar el proceso.
  if (!concurrency.acquire(ip)) {
    return tooMany(c, 'concurrency', 1);
  }

  try {
    // 3) Cuota global (todas las rutas juntas) y cuota diaria.
    const minute = hitRateLimit(`read:min:${ip}`, READ_GLOBAL_MAX, READ_GLOBAL_WINDOW_MS);
    if (!minute.allowed) return tooMany(c, 'global', minute.retryAfterSeconds);

    const daily = hitRateLimit(`read:day:${ip}`, READ_DAILY_MAX, READ_DAILY_WINDOW_MS);
    if (!daily.allowed) return tooMany(c, 'daily', daily.retryAfterSeconds);

    await next();
  } finally {
    concurrency.release(ip);
  }
}

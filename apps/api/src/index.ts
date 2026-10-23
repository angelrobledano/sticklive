import './instrument.js'; // Sentry.init — debe ir el PRIMERO de todo
import * as Sentry from '@sentry/node';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { logger as honoLogger } from 'hono/logger';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { logger } from '@sports/logger';
import { assertSchemaCurrent, SchemaOutdatedError } from '@sports/db';
import { assertEnv } from './lib/env.js';
import { rateLimit } from './lib/rate-limit.js';
import { corsOrigins } from './lib/cors-origins.js';
import { READ_LIMIT_MAX, READ_LIMIT_PATHS, READ_LIMIT_WINDOW_MS, HEAVY_READ_LIMITS } from './lib/read-limits.js';
import { cacheControlFor } from './lib/read-cache.js';
import { readGuard, isInternalRequest } from './lib/read-guard.js';
import { standingsRouter } from './routes/standings.js';
import { matchesRouter } from './routes/matches.js';
import { liveRouter } from './routes/live.js';
import { matchDetailRouter } from './routes/match-detail.js';
import { teamDetailRouter } from './routes/team-detail.js';
import { teamRecentRouter } from './routes/team-recent.js';
import { teamLogoRouter } from './routes/team-logo.js';
import { seasonOverviewRouter } from './routes/season-overview.js';
import { playerDetailRouter } from './routes/player-detail.js';
import { playerPhotoRouter } from './routes/player-photo.js';
import { playerInsightsRouter } from './routes/player-insights.js';
import { matchStreamRouter } from './routes/match-stream.js';
import { competitionsRouter } from './routes/competitions.js';
import { federationsRouter } from './routes/federations.js';
import { searchRouter } from './routes/search.js';
import { seasonStatsRouter } from './routes/season-stats.js';
import { seasonInsightsRouter } from './routes/season-insights.js';
import { authRouter } from './routes/auth.js';
import { adminRouter } from './routes/admin.js';
import { healthRouter } from './routes/health.js';
import { pushRouter } from './routes/push.js';
import { metaRouter } from './routes/meta.js';
import { redirectsRouter } from './routes/redirects.js';
import { stripeRouter } from './routes/payments-stripe.js';
import { statusRouter } from './routes/payments-status.js';
import { adsConfigRouter } from './routes/ads-config.js';

const app = new Hono();

// Middleware de logging HTTP
app.use('*', honoLogger());

// CORS — la web (puerto 3001 en dev, dominio propio en prod) consume la API
// desde el navegador con cabeceras propias (Authorization, X-Admin-Token).
// #307: localhost:3001 solo en no-producción (nunca en prod).
app.use('*', cors({
  origin: corsOrigins({
    nodeEnv: process.env['NODE_ENV'],
    webBaseUrl: process.env['WEB_BASE_URL'],
  }),
  allowHeaders: ['Content-Type', 'Authorization', 'X-Admin-Token'],
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  maxAge: 86_400,
}));

// Límite de tamaño de body (auditoría S8): corta payloads enormes (DoS). El
// webhook de Stripe y los POST normales caben de sobra en 64 KB.
app.use('*', bodyLimit({
  maxSize: 64 * 1024,
  onError: (c) => c.json({ error: 'payload_too_large' }, 413),
}));

// Caché de lectura (I1): Cache-Control por defecto en los GET estables (la
// política vive en lib/read-cache.ts). Se fija ANTES del handler; live/meta la
// sobreescriben con la suya. Reduce carga de Postgres en las repeticiones.
app.use('*', async (c, next) => {
  const cc = cacheControlFor(c.req.method, c.req.path);
  if (cc) c.header('Cache-Control', cc);
  await next();
  // #333: un error nunca debe servirse con caché pública. Los catch de ruta no
  // pasan por onError y heredaban la cabecera de lectura (p. ej. max-age=120).
  if (c.res.status >= 400) c.header('Cache-Control', 'no-store');
  // Los JSON de la API no son páginas: que los buscadores no los indexen
  // (robots.txt es solo una declaración; esta cabecera la refuerza).
  if (c.res.headers.get('content-type')?.includes('application/json')) {
    c.header('X-Robots-Tag', 'noindex, nofollow');
  }
});

// Anti-scraping (paquete A): cuota global y diaria por IP, concurrencia y
// detección de enumeración. Solo actúa sobre GET de datos; SSE, imágenes,
// health, auth, push, pagos y admin quedan fuera. Ver lib/read-guard.ts.
app.use('*', readGuard);

// Rate-limit de lectura (I1): tope generoso por IP en los GET más caros de BD.
// Defensivo anti-DoS; no toca /matches/:id/stream (SSE).
// La lista vive en lib/read-limits.ts: `/matches/:id` cubre también /matches/live
// y /matches/current, que NO deben registrarse aparte (duplicarían el contador y
// dejarían el tope real en 60/min pese a documentarse 120 — #333).
const readLimit = rateLimit(READ_LIMIT_MAX, READ_LIMIT_WINDOW_MS, undefined, isInternalRequest);
for (const path of READ_LIMIT_PATHS) app.use(path, readLimit);

// Topes más estrictos para los volcados de catálogo (temporada completa,
// overview y sitemap). Se suman al general; el efectivo es el menor. La web
// (SSR) queda exenta mediante el token interno: no compite con los visitantes.
for (const { path, max, windowMs } of HEAVY_READ_LIMITS) {
  app.use(path, rateLimit(max, windowMs, undefined, isInternalRequest));
}

// Health. #377(P3-12): `/health` (readiness) comprueba que Postgres responde
// además del proceso; NO lo usa el healthcheck del contenedor, porque un bache
// de BD no debe provocar un reinicio vía `autoheal` (incidente 2026-10-05). Ese
// healthcheck usa `/health/live` (liveness, sin BD). Ver routes/health.ts.
app.route('/', healthRouter);

// Raíz
app.get('/', (c) => {
  return c.json({
    name: 'Sports Results API',
    version: '0.1.0',
    endpoints: [
      'GET /health',
      'GET /health/live',
      'GET /competitions',
      'GET /competitions/:id/seasons',
      'GET /seasons/:id/overview',
      'GET /seasons/:id/standings',
      'GET /seasons/:id/matches[?gameweek=&status=&teamId=]',
      'GET /seasons/:id/stats',
      'GET /seasons/:id/insights',
      'GET /matches/live',
      'GET /matches/current',
      'GET /matches/:id',
      'GET /matches/:id/stream',
      'GET /ads/config',
      'GET /teams/:id',
      'GET /teams/:id/recent',
      'GET /teams/:id/logo',
      'GET /players/:id',
      'GET /players/:id/insights',
      'GET /players/:id/photo',
      'GET /search?q=',
      'GET /meta/sitemap',
      'GET /redirects/:type/:id',
    ],
  });
});

// Rutas
app.route('/competitions', competitionsRouter); // GET /competitions — listado
app.route('/federations', federationsRouter);   // GET /federations — árbol de federaciones
app.route('/search', searchRouter);            // GET /search?q= — búsqueda global (#255)
app.route('/seasons', standingsRouter);
app.route('/seasons', matchesRouter);
app.route('/matches', liveRouter);       // /matches/live — debe ir ANTES de /:id
app.route('/matches', matchStreamRouter); // /matches/:id/stream — SSE
app.route('/matches', matchDetailRouter); // /matches/:id
app.route('/teams',   teamLogoRouter);    // /teams/:id/logo - escudo (volumen/CDN)
app.route('/teams',   teamRecentRouter);  // /teams/:id/recent - últimos partidos (C9)
app.route('/teams',   teamDetailRouter);  // /teams/:id
app.route('/seasons', seasonOverviewRouter); // /seasons/:id/overview — después de standings/matches
app.route('/seasons', seasonStatsRouter);    // /seasons/:id/stats — líderes de temporada
app.route('/seasons', seasonInsightsRouter); // /seasons/:id/insights — datos destacados (C2)
app.route('/players',  playerPhotoRouter);   // /players/:id/photo — foto (proxy CDN)
app.route('/players',  playerInsightsRouter); // /players/:id/insights (C6)
app.route('/players',  playerDetailRouter);  // /players/:id
app.route('/payments/stripe', stripeRouter);   // proveedor ACTIVO: checkout + webhook
app.route('/payments/status', statusRouter);   // estado premium de la sesión (app móvil)
app.route('/ads/config', adsConfigRouter);     // config remota de ads (pública, fail-safe: todo apagado por defecto)
app.route('/auth', authRouter);                // magic links + favoritos en nube
app.route('/admin', adminRouter);              // panel de admin (X-Admin-Token)
app.route('/push', pushRouter);                // suscripciones Web Push
app.route('/meta', metaRouter);                // ids para sitemap
app.route('/redirects', redirectsRouter);      // bajas y fusiones de fichas (F1-7)

// 404 genérico
app.notFound((c) => {
  return c.json({ error: 'Not found' }, 404);
});

// Error handler global: nunca filtrar detalles internos al cliente (auditoría S7).
app.onError((err, c) => {
  c.header('Cache-Control', 'no-store'); // nunca cachear un 500 (I1)
  logger.error({ path: c.req.path, err }, 'Error no controlado en la API');
  Sentry.captureException(err, { tags: { path: c.req.path } });
  return c.json({ error: 'internal_error' }, 500);
});

// Red de seguridad (#333): sin handlers, un rechazo/excepción no capturados
// tumban el proceso sin dejar rastro. Logueamos y reportamos a Sentry.
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'unhandledRejection');
  Sentry.captureException(reason);
});
process.on('uncaughtException', (err) => {
  logger.error({ err }, 'uncaughtException');
  Sentry.captureException(err);
  process.exit(1);
});

async function start(): Promise<void> {
  // Validación de entorno antes de aceptar tráfico (fail fast, auditoría B1).
  assertEnv();

  // Versión de esquema (auditoría 2.3): no arrancar contra una BD cuyo esquema
  // va por detrás del código (p. ej. un backup viejo restaurado a mano). El
  // servicio migrate cubre el despliegue normal, no ese caso.
  await assertSchemaCurrent();

  const PORT = Number(process.env['PORT'] ?? 3000);

  const server = serve({ fetch: app.fetch, port: PORT }, () => {
    logger.info({ service: 'api', port: PORT }, `API escuchando en http://localhost:${PORT}`);
  });

  // Cierre limpio (auditoría B3): drenar conexiones al recibir SIGTERM/SIGINT.
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sig, () => {
      logger.info({ sig }, 'Apagando API…');
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 10_000).unref();
    });
  }
}

start().catch((err) => {
  if (err instanceof SchemaOutdatedError) {
    logger.error({ err: err.message }, 'Arranque abortado: esquema de BD desactualizado');
  } else {
    logger.error({ err }, 'Arranque de la API fallido');
  }
  Sentry.captureException(err);
  process.exit(1);
});

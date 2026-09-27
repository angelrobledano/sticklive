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
import { cacheControlFor } from './lib/read-cache.js';
import { standingsRouter } from './routes/standings.js';
import { matchesRouter } from './routes/matches.js';
import { liveRouter } from './routes/live.js';
import { matchDetailRouter } from './routes/match-detail.js';
import { teamDetailRouter } from './routes/team-detail.js';
import { teamLogoRouter } from './routes/team-logo.js';
import { seasonOverviewRouter } from './routes/season-overview.js';
import { playerDetailRouter } from './routes/player-detail.js';
import { playerPhotoRouter } from './routes/player-photo.js';
import { matchStreamRouter } from './routes/match-stream.js';
import { competitionsRouter } from './routes/competitions.js';
import { seasonStatsRouter } from './routes/season-stats.js';
import { authRouter } from './routes/auth.js';
import { adminRouter } from './routes/admin.js';
import { pushRouter } from './routes/push.js';
import { metaRouter } from './routes/meta.js';
import { stripeRouter } from './routes/payments-stripe.js';

const app = new Hono();

// Middleware de logging HTTP
app.use('*', honoLogger());

// CORS — la web (puerto 3001 en dev, dominio propio en prod) consume la API
// desde el navegador con cabeceras propias (Authorization, X-Admin-Token).
const WEB_ORIGIN = process.env['WEB_BASE_URL'] ?? 'http://localhost:3001';
app.use('*', cors({
  origin: [WEB_ORIGIN, 'http://localhost:3001'],
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
});

// Rate-limit de lectura (I1): tope generoso por IP en los GET más caros de BD.
// Defensivo anti-DoS; no toca /matches/:id/stream (SSE).
const readLimit = rateLimit(120, 60_000);
app.use('/seasons/:id/overview', readLimit);
app.use('/seasons/:id/stats', readLimit);
app.use('/teams/:id', readLimit);
app.use('/players/:id', readLimit);
// La home (la ruta más pesada) también: ver #153.
app.use('/matches/current', readLimit);
app.use('/matches/live', readLimit);
// Resto de lecturas públicas (#159): mismo tope generoso por IP.
app.use('/competitions', readLimit);
app.use('/seasons/:id/matches', readLimit);
app.use('/seasons/:id/standings', readLimit);
app.use('/matches/:id', readLimit);
app.use('/meta/sitemap', readLimit);

// Health check
app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Raíz
app.get('/', (c) => {
  return c.json({
    name: 'Sports Results API',
    version: '0.1.0',
    endpoints: [
      'GET /health',
      'GET /seasons/:id/standings',
      'GET /seasons/:id/matches[?gameweek=&status=&teamId=]',
      'GET /matches/live',
      'GET /matches/:id/stream',
    ],
  });
});

// Rutas
app.route('/competitions', competitionsRouter); // GET /competitions — listado
app.route('/seasons', standingsRouter);
app.route('/seasons', matchesRouter);
app.route('/matches', liveRouter);       // /matches/live — debe ir ANTES de /:id
app.route('/matches', matchStreamRouter); // /matches/:id/stream — SSE
app.route('/matches', matchDetailRouter); // /matches/:id
app.route('/teams',   teamLogoRouter);    // /teams/:id/logo — escudo (volumen/CDN)
app.route('/teams',   teamDetailRouter);  // /teams/:id
app.route('/seasons', seasonOverviewRouter); // /seasons/:id/overview — después de standings/matches
app.route('/seasons', seasonStatsRouter);    // /seasons/:id/stats — líderes de temporada
app.route('/players',  playerPhotoRouter);   // /players/:id/photo — foto (proxy CDN)
app.route('/players',  playerDetailRouter);  // /players/:id
app.route('/payments/stripe', stripeRouter);   // proveedor ACTIVO: checkout + webhook
app.route('/auth', authRouter);                // magic links + favoritos en nube
app.route('/admin', adminRouter);              // panel de admin (X-Admin-Token)
app.route('/push', pushRouter);                // suscripciones Web Push
app.route('/meta', metaRouter);                // ids para sitemap

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

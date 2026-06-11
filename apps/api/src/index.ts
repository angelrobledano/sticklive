import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { logger as honoLogger } from 'hono/logger';
import { cors } from 'hono/cors';
import { logger } from '@sports/logger';
import { standingsRouter } from './routes/standings.js';
import { matchesRouter } from './routes/matches.js';
import { liveRouter } from './routes/live.js';
import { matchDetailRouter } from './routes/match-detail.js';
import { teamDetailRouter } from './routes/team-detail.js';
import { seasonOverviewRouter } from './routes/season-overview.js';
import { playerDetailRouter } from './routes/player-detail.js';
import { paymentsRouter } from './routes/payments.js';
import { matchStreamRouter } from './routes/match-stream.js';
import { competitionsRouter } from './routes/competitions.js';
import { seasonStatsRouter } from './routes/season-stats.js';
import { authRouter } from './routes/auth.js';
import { adminRouter } from './routes/admin.js';
import { pushRouter } from './routes/push.js';
import { metaRouter } from './routes/meta.js';

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
      'POST /payments/redsys/create-json',
      'POST /payments/redsys/webhook',
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
app.route('/teams',   teamDetailRouter);  // /teams/:id
app.route('/seasons', seasonOverviewRouter); // /seasons/:id/overview — después de standings/matches
app.route('/seasons', seasonStatsRouter);    // /seasons/:id/stats — líderes de temporada
app.route('/players',  playerDetailRouter);  // /players/:id
app.route('/payments/redsys', paymentsRouter); // /payments/redsys/create-json + /webhook
app.route('/auth', authRouter);                // magic links + favoritos en nube
app.route('/admin', adminRouter);              // panel de admin (X-Admin-Token)
app.route('/push', pushRouter);                // suscripciones Web Push
app.route('/meta', metaRouter);                // ids para sitemap

// 404 genérico
app.notFound((c) => {
  return c.json({ error: 'Not found' }, 404);
});

const PORT = Number(process.env['PORT'] ?? 3000);

serve({ fetch: app.fetch, port: PORT }, () => {
  logger.info({ service: 'api', port: PORT }, `API escuchando en http://localhost:${PORT}`);
});

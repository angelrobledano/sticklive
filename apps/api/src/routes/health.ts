import { Hono } from 'hono';
import { db } from '@sports/db';
import { logger } from '@sports/logger';

/**
 * Health de la API, partido en dos señales (incidente 2026-10-05):
 *
 *   · `/health/live` — LIVENESS: ¿el proceso responde? No toca la BD. Es lo que
 *     mira el healthcheck del contenedor (`docker-compose.prod.yml`). Un bache
 *     de Postgres NO debe marcar la API como `unhealthy` ni hacer que `autoheal`
 *     la reinicie: reiniciarla no arregla la BD, solo añade un pool en frío y
 *     502s. Reiniciar por un fallo de una dependencia es matar al paciente por
 *     la fiebre.
 *
 *   · `/health` — READINESS/monitorización externa (#377): además del proceso,
 *     comprueba que Postgres responde con un `SELECT 1` barato; 503 si no. Lo
 *     consume el monitor externo (docs/operations.md) y el smoke del deploy.
 */
export const healthRouter = new Hono();

healthRouter.get('/health/live', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

healthRouter.get('/health', async (c) => {
  const timestamp = new Date().toISOString();
  try {
    await db.query('SELECT 1');
    return c.json({ status: 'ok', db: 'ok', timestamp });
  } catch (err) {
    logger.error({ err }, 'health: Postgres no responde');
    return c.json({ status: 'degraded', db: 'down', timestamp }, 503);
  }
});

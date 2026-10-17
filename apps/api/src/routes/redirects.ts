import { Hono } from 'hono';
import { resolveEntityRedirect, REDIRECT_ENTITY_TYPES, type RedirectEntityType } from '@sports/db';
import { logger } from '@sports/logger';
import { isUuid } from '../lib/uuid.js';
import { captureRouteError } from '../lib/route-error.js';

/**
 * GET /redirects/:type/:id — a dónde va una ficha que ya no existe (F1-7).
 *
 * La web lo consulta solo cuando la ficha da 404:
 *  · 200 `{ status: 'moved', newId }` → la web responde 308 al sustituto.
 *  · 200 `{ status: 'gone' }`         → existió y no tiene sustituto: 404.
 *  · 404                              → no consta (id que nunca existió).
 */
export const redirectsRouter = new Hono();

redirectsRouter.get('/:type/:id', async (c) => {
  const { type, id } = c.req.param();
  if (!(REDIRECT_ENTITY_TYPES as readonly string[]).includes(type) || !isUuid(id)) {
    return c.json({ error: 'invalid type or id' }, 400);
  }
  try {
    const resolution = await resolveEntityRedirect(type as RedirectEntityType, id);
    if (!resolution) return c.json({ error: 'not found' }, 404);
    return c.json(resolution);
  } catch (err) {
    captureRouteError(err, 'redirects] error');
    logger.error({ err }, '[redirects] error');
    return c.json({ error: 'Database error' }, 500);
  }
});

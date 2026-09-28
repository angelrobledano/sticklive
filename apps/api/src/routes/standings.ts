import { Hono } from 'hono';
import { getStandings } from '@sports/db';
import { isUuid } from '../lib/uuid.js';

export const standingsRouter = new Hono();

/**
 * GET /seasons/:id/standings
 * Query params opcionales:
 *   ?group=<nombre>  — filtra por grupo si la competición tiene varios
 *
 * Orden: position ASC (NULLs al final), desempate por points DESC, goal_diff DESC
 */
standingsRouter.get('/:id/standings', async (c) => {
  const seasonId = c.req.param('id');
  const group = c.req.query('group');

  // Un id no-UUID haría fallar el cast a uuid de Postgres y devolvería 500
  // (enlace corrupto/bot) en vez de 404 (#275).
  if (!isUuid(seasonId)) return c.json({ error: 'Not found' }, 404);

  try {
    const rows = await getStandings(seasonId, group);

    if (rows.length === 0) {
      return c.json(
        { error: 'No standings found for this season', seasonId },
        404
      );
    }

    return c.json({
      seasonId,
      group: group ?? null,
      count: rows.length,
      standings: rows,
    });
  } catch (err) {
    return c.json({ error: 'Database error' }, 500);
  }
});

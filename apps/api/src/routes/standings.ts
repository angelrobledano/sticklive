import { Hono } from 'hono';
import { getStandings } from '@sports/db';

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
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ error: 'Database error', detail: message }, 500);
  }
});

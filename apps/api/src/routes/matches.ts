import { Hono } from 'hono';
import { getMatchesBySeason } from '@sports/db';

export const matchesRouter = new Hono();

/**
 * GET /seasons/:id/matches
 *
 * Query params opcionales:
 *   ?gameweek=<número>   — filtra por jornada
 *   ?status=<string>     — scheduled | live | finished | postponed
 *   ?teamId=<uuid>       — partidos de un equipo (local o visitante)
 */
matchesRouter.get('/:id/matches', async (c) => {
  const seasonId = c.req.param('id');

  const gameweekRaw = c.req.query('gameweek');
  const status     = c.req.query('status');
  const teamId     = c.req.query('teamId');

  // Validar gameweek si viene
  const gameweek = gameweekRaw !== undefined ? parseInt(gameweekRaw, 10) : undefined;
  if (gameweekRaw !== undefined && (isNaN(gameweek!) || gameweek! < 1)) {
    return c.json({ error: 'gameweek must be a positive integer' }, 400);
  }

  // Validar status si viene
  const validStatuses = ['scheduled', 'live', 'finished', 'postponed', 'cancelled'];
  if (status !== undefined && !validStatuses.includes(status)) {
    return c.json(
      { error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` },
      400
    );
  }

  try {
    // exactOptionalPropertyTypes: sólo incluir propiedades que tienen valor
    const filter: Parameters<typeof getMatchesBySeason>[0] = { seasonId };
    if (gameweek !== undefined) filter.gameweek = gameweek;
    if (status   !== undefined) filter.status   = status;
    if (teamId   !== undefined) filter.teamId   = teamId;

    const rows = await getMatchesBySeason(filter);

    return c.json({
      seasonId,
      filters: {
        gameweek: gameweek ?? null,
        status: status ?? null,
        teamId: teamId ?? null,
      },
      count: rows.length,
      matches: rows,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ error: 'Database error', detail: message }, 500);
  }
});

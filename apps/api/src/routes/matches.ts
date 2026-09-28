import { Hono } from 'hono';
import { getMatchesBySeason } from '@sports/db';
import { isUuid } from '../lib/uuid.js';

export const matchesRouter = new Hono();

/**
 * Valida `?gameweek=`:
 *  - `undefined` si no viene el parámetro,
 *  - el entero si es válido,
 *  - `null` si es inválido (debe responder 400).
 *
 * Antes se usaba `parseInt`, que aceptaba parciales como `3abc` → 3 (#333).
 * Exportada para poder testearla sin base de datos.
 */
export function parseGameweek(raw: string | undefined): number | null | undefined {
  if (raw === undefined) return undefined;
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 ? n : null;
}

/**
 * Valida el filtro `?teamId=`:
 *  - `undefined` si no viene el parámetro,
 *  - el UUID si es válido,
 *  - `null` si es inválido (debe responder 400).
 *
 * Un teamId no-UUID hacía fallar el cast a uuid de Postgres y devolvía 500
 * (#321). Para un parámetro de query, un valor malformado es un error de
 * petición (400), no un recurso inexistente.
 */
export function parseTeamId(raw: string | undefined): string | null | undefined {
  if (raw === undefined) return undefined;
  return isUuid(raw) ? raw : null;
}

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

  // Un id no-UUID haría fallar el cast a uuid de Postgres y devolvería 500
  // (enlace corrupto/bot) en vez de 404 (#275).
  if (!isUuid(seasonId)) return c.json({ error: 'Not found' }, 404);

  const gameweekRaw = c.req.query('gameweek');
  const status     = c.req.query('status');
  const teamIdRaw  = c.req.query('teamId');

  // Validar gameweek si viene
  const gameweek = parseGameweek(gameweekRaw);
  if (gameweek === null) {
    return c.json({ error: 'gameweek must be a positive integer' }, 400);
  }

  // Validar teamId si viene (#321): un id no-UUID daba 500 en la BD.
  const teamId = parseTeamId(teamIdRaw);
  if (teamId === null) {
    return c.json({ error: 'teamId must be a UUID' }, 400);
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
    return c.json({ error: 'Database error' }, 500);
  }
});

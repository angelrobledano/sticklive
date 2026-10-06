import { Hono } from 'hono';
import { getMatchesBySeason } from '@sports/db';
import { isUuid } from '../lib/uuid.js';
import { seasonVisible } from '../lib/visibility.js';
import { captureRouteError } from '../lib/route-error.js';
import { setBounded } from '../lib/bounded-cache.js';

export const matchesRouter = new Hono();

/**
 * Micro-caché de la ruta más pesada de la API (#323): la temporada completa es
 * un JSON de hasta ~1,7 MB cuyo stringify cae en el event loop en cada hit.
 * La fuente sólo cambia vía ETL (horario) y directo (45 s), así que un TTL de
 * 30 s es invisible y elimina el re-trabajo en ráfaga. Acotada con setBounded
 * (#333): la clave incluye los filtros, no debe crecer sin límite.
 */
const MATCHES_CACHE_TTL_MS = Number(process.env['MATCHES_CACHE_TTL_MS'] ?? 30_000);
const MATCHES_CACHE_MAX = 50;
const matchesCache = new Map<string, { body: unknown; expiresAt: number }>();

function cachedMatches(key: string, fn: () => Promise<unknown>): Promise<unknown> {
  const now = Date.now();
  for (const [k, v] of matchesCache) if (v.expiresAt <= now) matchesCache.delete(k);
  const hit = matchesCache.get(key);
  if (hit && hit.expiresAt > now) return Promise.resolve(hit.body);
  return fn().then((body) => {
    setBounded(matchesCache, key, { body, expiresAt: Date.now() + MATCHES_CACHE_TTL_MS }, MATCHES_CACHE_MAX);
    return body;
  });
}

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

  if (!(await seasonVisible(seasonId))) return c.json({ error: 'Not found' }, 404);

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

  // Paginación opcional (#323). Antes ?limit/?page se IGNORABAN en silencio y
  // la ruta devolvía siempre la temporada completa. Ahora se respetan y los
  // valores inválidos son un 400 explícito. Sin ?limit, comportamiento previo
  // (la web pide la lista completa y pagina en cliente por jornada).
  const limitRaw = c.req.query('limit');
  const offsetRaw = c.req.query('offset');
  let limit: number | undefined;
  let offset: number | undefined;
  if (limitRaw !== undefined) {
    if (!/^\d+$/.test(limitRaw) || Number(limitRaw) < 1 || Number(limitRaw) > 2000) {
      return c.json({ error: 'limit must be an integer between 1 and 2000' }, 400);
    }
    limit = Number(limitRaw);
  }
  if (offsetRaw !== undefined) {
    if (!/^\d+$/.test(offsetRaw)) {
      return c.json({ error: 'offset must be a non-negative integer' }, 400);
    }
    offset = Number(offsetRaw);
  }

  try {
    // exactOptionalPropertyTypes: sólo incluir propiedades que tienen valor
    const filter: Parameters<typeof getMatchesBySeason>[0] = { seasonId };
    if (gameweek !== undefined) filter.gameweek = gameweek;
    if (status   !== undefined) filter.status   = status;
    if (teamId   !== undefined) filter.teamId   = teamId;
    if (limit    !== undefined) filter.limit   = limit;
    if (offset   !== undefined) filter.offset  = offset;

    const cacheKey = `${seasonId}|${gameweek ?? ''}|${status ?? ''}|${teamId ?? ''}|${limit ?? ''}|${offset ?? ''}`;
    const rows = await cachedMatches(cacheKey, () => getMatchesBySeason(filter)) as Awaited<ReturnType<typeof getMatchesBySeason>>;

    return c.json({
      seasonId,
      filters: {
        gameweek: gameweek ?? null,
        status: status ?? null,
        teamId: teamId ?? null,
        limit: limit ?? null,
        offset: offset ?? null,
      },
      count: rows.length,
      matches: rows,
    });
  } catch (err) {
    captureRouteError(err, 'GET /seasons/:id/matches');
    return c.json({ error: 'Database error' }, 500);
  }
});

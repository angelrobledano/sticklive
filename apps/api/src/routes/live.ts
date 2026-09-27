import { Hono } from 'hono';
import { db } from '@sports/db';
import { resolveCurrentWindow } from '../lib/match-window.js';

export const liveRouter = new Hono();

/**
 * Micro-caché en memoria para las dos rutas más sondeadas del producto.
 *
 * `useLiveScores` en la web sondea /current cada 25 s con `no-store` DESDE CADA
 * NAVEGADOR (no pasa por la caché de Next). Sin esto, 500 usuarios en la home
 * son ~20 req/s de una consulta con 4 JOINs pegando directa a Postgres.
 *
 * Un TTL de segundos es invisible para el usuario (el scraper refresca cada
 * ~45 s de todas formas) y colapsa esas 20 req/s en una sola query.
 *
 * Es deliberadamente un Map en memoria: hoy la API es un único proceso. Si se
 * escala a varias réplicas, sustituir por Redis manteniendo esta firma.
 */
const CACHE_TTL_MS = Number(process.env['LIVE_CACHE_TTL_MS'] ?? 5_000);
const cache = new Map<string, { body: unknown; expiresAt: number }>();

async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.body as T;
  const body = await fn();
  cache.set(key, { body, expiresAt: Date.now() + CACHE_TTL_MS });
  return body;
}

// Purga periódica: las claves de /current varían con los parámetros de ventana.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of cache) if (v.expiresAt <= now) cache.delete(k);
}, 60_000).unref?.();

interface LiveMatchRow {
  id: string;
  season_id: string;
  round_id: string | null;
  home_score: number | null;
  away_score: number | null;
  status: string;
  scheduled_at: Date | null;
  started_at: Date | null;
  live_is_halftime: boolean | null;
  win_type: string | null;
  winner_team_id: string | null;
  home_pen: number | null;
  away_pen: number | null;
  venue_name: string | null;
  venue_city: string | null;
  source_ref: string | null;
  competition_id: string | null;
  competition_name: string | null;
  competition_slug: string | null;
  competition_timezone: string | null;
  // equipo local
  home_team_id: string;
  home_team_name: string;
  home_team_short_name: string | null;
  home_team_logo_url: string | null;
  // equipo visitante
  away_team_id: string;
  away_team_name: string;
  away_team_short_name: string | null;
  away_team_logo_url: string | null;
}

function mapLiveRow(row: LiveMatchRow) {
  return {
    id:          row.id,
    seasonId:    row.season_id,
    roundId:     row.round_id,
    competitionId:   row.competition_id,
    competitionName: row.competition_name,
    competitionSlug: row.competition_slug,
    competitionTimezone: row.competition_timezone,
    status:      row.status,
    isHalftime:  row.live_is_halftime ?? false,
    winType:      row.win_type,
    winnerTeamId: row.winner_team_id,
    penalties:    (row.home_pen != null || row.away_pen != null)
      ? { home: row.home_pen, away: row.away_pen } : null,
    scheduledAt: row.scheduled_at,
    startedAt:   row.started_at,
    venue:       row.venue_name
      ? { name: row.venue_name, city: row.venue_city }
      : null,
    score: {
      home: row.home_score,
      away: row.away_score,
    },
    homeTeam: {
      id:        row.home_team_id,
      name:      row.home_team_name,
      shortName: row.home_team_short_name,
      logoUrl:   row.home_team_logo_url,
    },
    awayTeam: {
      id:        row.away_team_id,
      name:      row.away_team_name,
      shortName: row.away_team_short_name,
      logoUrl:   row.away_team_logo_url,
    },
  };
}

/**
 * GET /matches/live
 * Devuelve todos los partidos con status = 'live', enriquecidos con los
 * datos de equipo local y visitante (nombre, escudo).
 */
liveRouter.get('/live', async (c) => {
  try {
    const payload = await cached('live', async () => {
    const result = await db.query<LiveMatchRow>(`
      SELECT
        m.id,
        m.season_id,
        m.round_id,
        m.home_score,
        m.away_score,
        m.status,
        m.live_is_halftime,
        m.win_type, m.winner_team_id, m.home_pen, m.away_pen,
        m.scheduled_at,
        m.started_at,
        m.venue_name,
        m.venue_city,
        m.source_ref,
        comp.id         AS competition_id,
        comp.name       AS competition_name,
        comp.slug       AS competition_slug,
        comp.timezone   AS competition_timezone,
        -- equipo local
        ht.id           AS home_team_id,
        ht.name         AS home_team_name,
        ht.short_name   AS home_team_short_name,
        ht.logo_url     AS home_team_logo_url,
        -- equipo visitante
        at.id           AS away_team_id,
        at.name         AS away_team_name,
        at.short_name   AS away_team_short_name,
        at.logo_url     AS away_team_logo_url
      FROM matches m
      LEFT JOIN seasons s2       ON s2.id = m.season_id
      LEFT JOIN competitions comp ON comp.id = s2.competition_id
      LEFT JOIN teams ht ON ht.id = m.home_team_id
      LEFT JOIN teams at ON at.id = m.away_team_id
      WHERE m.status = 'live'
      ORDER BY m.started_at ASC NULLS LAST
    `);

      const matches = result.rows.map(mapLiveRow);
      return { count: matches.length, matches };
    });

    // Caddy y el navegador absorben la ráfaga; SWR evita el thundering herd.
    c.header('Cache-Control', 'public, max-age=5, stale-while-revalidate=30');
    return c.json(payload);
  } catch (err) {
    // El detalle se queda en el log del servidor: nunca al cliente (S7; #152).
    console.error('[live] error:', err);
    return c.json({ error: 'Database error' }, 500);
  }
});

/**
 * GET /matches/current
 * Devuelve todos los partidos (scheduled + live + finished) de las
 * temporadas marcadas como is_current=true. Permite a la home page
 * mostrar partidos de TODAS las competiciones activas sin depender
 * de un único SEASON_ID hardcodeado.
 */
liveRouter.get('/current', async (c) => {
  try {
    // Ventana temporal: en vez de devolver TODO el calendario de todas las
    // temporadas actuales (que crece sin límite al escalar competiciones,
    // auditoría A2), se acota a [hoy-8d, hoy+15d] por defecto. La home muestra
    // hoy ± ~2 semanas, así que es suficiente. Override opcional con ?days= o
    // ?from=&to= (ISO). Tope de seguridad de 120 días.
    // Ventana temporal (auditoría A2). Lógica pura y testeada en match-window.ts.
    const win = resolveCurrentWindow({
      days: c.req.query('days'),
      from: c.req.query('from'),
      to: c.req.query('to'),
    });

    let where = '';
    const params: unknown[] = [];
    if (win.kind === 'range') {
      params.push(win.from, win.to);
      where = `AND m.scheduled_at >= $1::timestamptz AND m.scheduled_at < ($2::timestamptz + INTERVAL '1 day')`;
    } else {
      // Parametrizado con make_interval en vez de interpolar en la plantilla:
      // los días vienen de ?days= (saneado en resolveCurrentWindow, pero no
      // queremos que la seguridad dependa sólo de ese saneado).
      params.push(win.backDays, win.fwdDays);
      where = `AND m.scheduled_at >= NOW() - make_interval(days => $1::int)
               AND m.scheduled_at <  NOW() + make_interval(days => $2::int)`;
    }

    const cacheKey = win.kind === 'range'
      ? `current:range:${win.from}:${win.to}`
      : `current:days:${win.backDays}:${win.fwdDays}`;

    const payload = await cached(cacheKey, async () => {
    const result = await db.query<LiveMatchRow>(`
      SELECT
        m.id, m.season_id, m.round_id,
        m.home_score, m.away_score, m.status, m.live_is_halftime,
        m.win_type, m.winner_team_id, m.home_pen, m.away_pen,
        m.scheduled_at, m.started_at, m.venue_name, m.venue_city, m.source_ref,
        comp.id AS competition_id, comp.name AS competition_name,
        comp.slug AS competition_slug,
        comp.timezone AS competition_timezone,
        ht.id AS home_team_id, ht.name AS home_team_name,
        ht.short_name AS home_team_short_name, ht.logo_url AS home_team_logo_url,
        at.id AS away_team_id, at.name AS away_team_name,
        at.short_name AS away_team_short_name, at.logo_url AS away_team_logo_url
      FROM matches m
      JOIN seasons s ON s.id = m.season_id AND s.is_current = true
      JOIN competitions comp ON comp.id = s.competition_id
      LEFT JOIN teams ht ON ht.id = m.home_team_id
      LEFT JOIN teams at ON at.id = m.away_team_id
      WHERE m.status IN ('scheduled', 'live', 'finished')
        ${where}
      ORDER BY m.scheduled_at ASC NULLS LAST
    `, params);

      const matches = result.rows.map(mapLiveRow);
      return { count: matches.length, matches };
    });

    c.header('Cache-Control', 'public, max-age=5, stale-while-revalidate=30');
    return c.json(payload);
  } catch (err) {
    // El detalle se queda en el log del servidor: nunca al cliente (S7; #152).
    console.error('[live] error:', err);
    return c.json({ error: 'Database error' }, 500);
  }
});

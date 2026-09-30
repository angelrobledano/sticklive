import { Hono } from 'hono';
import { db } from '@sports/db';
import { logger } from '@sports/logger';
import { isUuid } from '../lib/uuid.js';
import { captureRouteError } from '../lib/route-error.js';
import {
  buildMatchDetail,
  type MatchDtoRow,
  type MatchDtoEventRow,
  type MatchLineupRow,
} from '../lib/match-dto.js';

export const matchDetailRouter = new Hono();

/**
 * GET /matches/:id
 * Devuelve el detalle completo de un partido: cabecera, eventos ordenados y stats derivadas.
 *
 * La construcción del DTO vive en `lib/match-dto.ts` (mapper puro) y es la MISMA
 * que usa el snapshot SSE (#283), de modo que REST y directo nunca divergen.
 */
matchDetailRouter.get('/:id', async (c) => {
  const id = c.req.param('id');

  // Un id no-UUID haría fallar el cast a uuid de Postgres y devolvería 500
  // (enlace corrupto/bot) en vez de 404 (#275).
  if (!isUuid(id)) return c.json({ error: 'Not found' }, 404);

  try {
    // #333: las tres queries sólo dependen de `id` (no de la fila de cabecera).
    // En serie eran tres round-trips; en paralelo el tiempo es el máximo, no la
    // suma. Si el partido no existe, las de eventos/lineups devuelven vacío.
    const [matchResult, eventsResult, lineupsResult] = await Promise.all([
      // 1) Cabecera del partido
      db.query<MatchDtoRow>(`
        SELECT
          m.id, m.season_id, m.round_id,
          m.home_score, m.away_score, m.home_fouls, m.away_fouls, m.status, m.event_coverage,
          m.home_goals_reg, m.away_goals_reg, m.home_pen, m.away_pen, m.win_type, m.winner_team_id, m.penalty_shootout,
          m.scheduled_at, m.started_at, m.finished_at,
          m.venue_name, m.venue_city, m.referee, m.source_ref, m.video_url,
          m.live_period, m.live_clock_seconds, m.live_clock_at, m.live_is_halftime,
          ht.id           AS home_team_id,
          ht.name         AS home_team_name,
          ht.short_name   AS home_team_short_name,
          ht.logo_url     AS home_team_logo_url,
          at.id           AS away_team_id,
          at.name         AS away_team_name,
          at.short_name   AS away_team_short_name,
          at.logo_url     AS away_team_logo_url,
          comp.id         AS competition_id,
          comp.name       AS competition_name,
          comp.slug       AS competition_slug,
          comp.timezone   AS competition_timezone
        FROM matches m
        LEFT JOIN teams ht ON ht.id = m.home_team_id
        LEFT JOIN teams at ON at.id = m.away_team_id
        LEFT JOIN seasons s        ON s.id = m.season_id
        LEFT JOIN competitions comp ON comp.id = s.competition_id
        WHERE m.id = $1
      `, [id]),

      // 2) Eventos del partido ordenados cronológicamente
      db.query<MatchDtoEventRow>(`
        SELECT
          e.id, e.event_type, e.minute, e.period, e.clock,
          e.team_id, e.detail,
          e.player_id,
          p.first_name  AS player_first_name,
          p.last_name   AS player_last_name
        FROM match_events e
        LEFT JOIN players p ON p.id = e.player_id
        WHERE e.match_id = $1
        ORDER BY
          COALESCE(e.period, 99) ASC,
          -- #285: el crono del acta es cuenta atrás MM:SS; a mayor crono restante,
          -- antes ocurrió. Es la clave principal cuando existe (así los eventos con
          -- crono pero sin minuto no caen al final), y el minuto queda de fallback.
          -- "MM:SS" con minutos a dos cifras hace que el orden textual == numérico.
          e.clock DESC NULLS LAST,
          COALESCE(e.minute, 9999) ASC,
          e.created_at ASC
      `, [id]),

      // 3) Alineaciones (si el scraper de ficha las ha cargado)
      db.query<MatchLineupRow>(`
        SELECT ml.is_home, ml.jersey_number, ml.player_name, ml.player_id,
               ml.is_goalkeeper, ml.is_starter, ml.is_captain, ml.goals, ml.assists,
               p.photo_url
        FROM match_lineups ml
        LEFT JOIN players p ON p.id = ml.player_id
        WHERE ml.match_id = $1
          AND ml.role IS NULL  -- jugadores; el cuerpo técnico se muestra en la ficha de equipo
        ORDER BY ml.is_home DESC, ml.is_starter DESC, ml.jersey_number ASC NULLS LAST
      `, [id]),
    ]);

    if (matchResult.rows.length === 0) {
      return c.json({ error: 'Match not found' }, 404);
    }

    const row = matchResult.rows[0]!;  // guarda rows.length === 0 lo asegura

    // 4) DTO único (cabecera + eventos + stats + alineaciones)
    const { match, events, stats, lineups } = buildMatchDetail(row, eventsResult.rows, lineupsResult.rows);

    return c.json({ match, events, stats, lineups });
  } catch (err) {
    captureRouteError(err, 'match-detail] GET /:id error');
    logger.error({ err }, '[match-detail] GET /:id error');
    return c.json({ error: 'Database error' }, 500);
  }
});

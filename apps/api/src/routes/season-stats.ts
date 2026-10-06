import { Hono } from 'hono';
import { db } from '@sports/db';
import { logger } from '@sports/logger';
import { isUuid } from '../lib/uuid.js';
import { seasonVisible } from '../lib/visibility.js';
import { captureRouteError } from '../lib/route-error.js';
import { penaltyScoredSql } from '../lib/penalty-sql.js';

export const seasonStatsRouter = new Hono();

interface LeaderRow {
  player_id: string | null;
  player_name: string;
  photo_url: string | null;
  team_id: string | null;
  team_short: string | null;
  team_name: string | null;
  goals: string;
  assists: string;
}

/**
 * GET /seasons/:id/stats
 * Líderes de la temporada: goleadores, asistentes y tarjetas.
 * Goles/asistencias desde match_lineups (suma por partido de la ficha);
 * tarjetas desde match_events.
 *
 * POOL (#324): la versión previa lanzaba 4 queries en Promise.all; cada una
 * toma un cliente del pool (max 10, timeout 5 s) y con 3 requests concurrentes
 * se agotaba y las siguientes esperaban hasta el timeout. Ahora son 2 queries
 * (goleadores+asistentes comparten agregación; tarjetas+bola parada comparten
 * FROM en una CTE): mismo resultado, la mitad de clientes y la mitad de
 * escaneos.
 */
seasonStatsRouter.get('/:id/stats', async (c) => {
  const seasonId = c.req.param('id');

  // Un id no-UUID haría fallar el cast a uuid de Postgres y devolvería 500
  // (enlace corrupto/bot) en vez de 404 (#275).
  if (!isUuid(seasonId)) return c.json({ error: 'Not found' }, 404);

  if (!(await seasonVisible(seasonId))) return c.json({ error: 'Not found' }, 404);

  try {
    const [leaders, eventStats] = await Promise.all([
      // Goleadores + asistentes: UNA agregación de match_lineups (antes eran dos
      // scans idénticos). Post-proceso en JS para recortar cada ranking.
      db.query<LeaderRow>(`
        SELECT ml.player_id, ml.player_name, p.photo_url,
               tm.id AS team_id, tm.short_name AS team_short, tm.name AS team_name,
               SUM(ml.goals)::text   AS goals,
               SUM(ml.assists)::text AS assists
        FROM match_lineups ml
        JOIN matches m ON m.id = ml.match_id
        LEFT JOIN players p ON p.id = ml.player_id
        LEFT JOIN teams tm ON tm.id = CASE WHEN ml.is_home THEN m.home_team_id ELSE m.away_team_id END
        WHERE m.season_id = $1
        GROUP BY ml.player_id, ml.player_name, p.photo_url, tm.id, tm.short_name, tm.name
        HAVING COALESCE(SUM(ml.goals), 0) > 0 OR COALESCE(SUM(ml.assists), 0) > 0
      `, [seasonId]),
      // Tarjetas (por jugador) y eficiencia a bola parada (por equipo): mismo
      // FROM/WHERE sobre match_events → una CTE cada una, una ida y vuelta.
      db.query<{
        top_cards: Array<{
          player_id: string | null; player_name: string; photo_url: string | null;
          team_id: string | null; team_short: string | null; team_name: string | null;
          value: string; extra: string;
        }>;
        set_pieces: Array<{
          team_id: string; team_short: string | null; team_name: string | null;
          fd_total: string; fd_scored: string; pen_total: string; pen_scored: string;
        }>;
      }>(`
        WITH cards AS (
          SELECT e.player_id,
                 -- Formato fuente "APELLIDOS NOMBRE": el front invierte y
                 -- title-casea igual que en goleadores/asistentes (consistencia)
                 COALESCE(p.last_name || ' ' || p.first_name, 'Desconocido') AS player_name,
                 p.photo_url,
                 e.team_id, tm.short_name AS team_short, tm.name AS team_name,
                 COUNT(*) FILTER (WHERE e.event_type = 'blue_card')::text AS value,
                 COUNT(*) FILTER (WHERE e.event_type = 'red_card')::text  AS extra
          FROM match_events e
          JOIN matches m ON m.id = e.match_id
          LEFT JOIN players p ON p.id = e.player_id
          LEFT JOIN teams tm ON tm.id = e.team_id
          WHERE m.season_id = $1
            AND e.event_type IN ('blue_card', 'red_card')
            AND e.player_id IS NOT NULL
          GROUP BY e.player_id, p.first_name, p.last_name, p.photo_url, e.team_id, tm.short_name, tm.name
          ORDER BY COUNT(*) FILTER (WHERE e.event_type = 'red_card') DESC,
                   COUNT(*) FILTER (WHERE e.event_type = 'blue_card') DESC
          LIMIT 30
        ),
        -- Eficiencia a bola parada POR EQUIPO. Nota: la fuente solo identifica
        -- al lanzador de una FD cuando acaba en gol, así que el % por jugador
        -- estaría sesgado — por equipo es el dato honesto.
        set_pieces AS (
          SELECT e.team_id,
                 tm.short_name AS team_short, tm.name AS team_name,
                 COUNT(*) FILTER (WHERE e.event_type = 'direct_foul')::text AS fd_total,
                 COUNT(*) FILTER (WHERE e.event_type = 'direct_foul' AND e.detail = 'marcada')::text AS fd_scored,
                 COUNT(*) FILTER (WHERE e.event_type = 'penalty')::text AS pen_total,
                 COUNT(*) FILTER (
                   WHERE e.event_type = 'penalty'
                     AND ${penaltyScoredSql('e')}
                 )::text AS pen_scored
          FROM match_events e
          JOIN matches m ON m.id = e.match_id
          JOIN teams tm ON tm.id = e.team_id
          WHERE m.season_id = $1
            AND e.event_type IN ('direct_foul', 'penalty')
            AND e.team_id IS NOT NULL
          GROUP BY e.team_id, tm.short_name, tm.name
          ORDER BY COUNT(*) FILTER (WHERE e.event_type = 'direct_foul' AND e.detail = 'marcada') DESC
        )
        SELECT
          (SELECT COALESCE(jsonb_agg(row_to_json(c)), '[]'::jsonb) FROM cards c)  AS top_cards,
          (SELECT COALESCE(jsonb_agg(row_to_json(s)), '[]'::jsonb) FROM set_pieces s) AS set_pieces
      `, [seasonId]),
    ]);

    const toLeader = (r: { player_id: string | null; player_name: string; photo_url: string | null; team_id: string | null; team_short: string | null; team_name: string | null; value: string | number; extra: string | number }) => ({
      playerId:   r.player_id,
      playerName: r.player_name,
      photoUrl:   r.photo_url,
      teamId:     r.team_id,
      teamShort:  r.team_short,
      teamName:   r.team_name,
      value:      Number(r.value),
      extra:      Number(r.extra ?? 0),
    });

    const leadersRows = leaders.rows.map((r) => ({
      player_id: r.player_id,
      player_name: r.player_name,
      photo_url: r.photo_url,
      team_id: r.team_id,
      team_short: r.team_short,
      team_name: r.team_name,
      goals: Number(r.goals ?? 0),
      assists: Number(r.assists ?? 0),
    }));
    const topScorers = leadersRows
      .filter((r) => r.goals > 0)
      .sort((a, b) => b.goals - a.goals || b.assists - a.assists)
      .slice(0, 30)
      .map((r) => toLeader({ ...r, value: r.goals, extra: r.assists }));
    const topAssists = leadersRows
      .filter((r) => r.assists > 0)
      .sort((a, b) => b.assists - a.assists || b.goals - a.goals)
      .slice(0, 30)
      .map((r) => toLeader({ ...r, value: r.assists, extra: r.goals }));

    const pct = (scored: number, total: number) =>
      total > 0 ? Math.round((scored / total) * 100) : null;

    return c.json({
      topScorers,
      topAssists,
      topCards:   (eventStats.rows[0]?.top_cards ?? []).map(toLeader),
      setPieces:  (eventStats.rows[0]?.set_pieces ?? []).map((r) => {
        const fdTotal = Number(r.fd_total), fdScored = Number(r.fd_scored);
        const penTotal = Number(r.pen_total), penScored = Number(r.pen_scored);
        return {
          teamId:    r.team_id,
          teamShort: r.team_short,
          teamName:  r.team_name,
          directFouls: { total: fdTotal, scored: fdScored, pct: pct(fdScored, fdTotal) },
          penalties:   { total: penTotal, scored: penScored, pct: pct(penScored, penTotal) },
        };
      }),
    });
  } catch (err) {
    captureRouteError(err, 'GET /seasons/:id/stats');
    logger.error({ err }, '[season-stats] GET /:id/stats error');
    return c.json({ error: 'Database error' }, 500);
  }
});

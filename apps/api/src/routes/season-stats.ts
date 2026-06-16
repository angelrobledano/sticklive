import { Hono } from 'hono';
import { db } from '@sports/db';

export const seasonStatsRouter = new Hono();

interface LeaderRow {
  player_id: string | null;
  player_name: string;
  photo_url: string | null;
  team_id: string | null;
  team_short: string | null;
  team_name: string | null;
  value: string; // SUM/COUNT → bigint como string
  extra: string | null;
}

/**
 * GET /seasons/:id/stats
 * Líderes de la temporada: goleadores, asistentes y tarjetas.
 * Goles/asistencias desde match_lineups (suma por partido de la ficha);
 * tarjetas desde match_events.
 */
seasonStatsRouter.get('/:id/stats', async (c) => {
  const seasonId = c.req.param('id');

  try {
    const [scorers, assists, cards, setPieces] = await Promise.all([
      db.query<LeaderRow>(`
        SELECT ml.player_id, ml.player_name, p.photo_url,
               tm.id AS team_id, tm.short_name AS team_short, tm.name AS team_name,
               SUM(ml.goals)::text AS value,
               SUM(ml.assists)::text AS extra
        FROM match_lineups ml
        JOIN matches m ON m.id = ml.match_id
        LEFT JOIN players p ON p.id = ml.player_id
        LEFT JOIN teams tm ON tm.id = CASE WHEN ml.is_home THEN m.home_team_id ELSE m.away_team_id END
        WHERE m.season_id = $1
        GROUP BY ml.player_id, ml.player_name, p.photo_url, tm.id, tm.short_name, tm.name
        HAVING SUM(ml.goals) > 0
        ORDER BY SUM(ml.goals) DESC, SUM(ml.assists) DESC
        LIMIT 30
      `, [seasonId]),
      db.query<LeaderRow>(`
        SELECT ml.player_id, ml.player_name, p.photo_url,
               tm.id AS team_id, tm.short_name AS team_short, tm.name AS team_name,
               SUM(ml.assists)::text AS value,
               SUM(ml.goals)::text AS extra
        FROM match_lineups ml
        JOIN matches m ON m.id = ml.match_id
        LEFT JOIN players p ON p.id = ml.player_id
        LEFT JOIN teams tm ON tm.id = CASE WHEN ml.is_home THEN m.home_team_id ELSE m.away_team_id END
        WHERE m.season_id = $1
        GROUP BY ml.player_id, ml.player_name, p.photo_url, tm.id, tm.short_name, tm.name
        HAVING SUM(ml.assists) > 0
        ORDER BY SUM(ml.assists) DESC, SUM(ml.goals) DESC
        LIMIT 30
      `, [seasonId]),
      db.query<LeaderRow>(`
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
      `, [seasonId]),
      // Eficiencia a bola parada POR EQUIPO. Nota: la fuente solo identifica
      // al lanzador de una FD cuando acaba en gol, así que el % por jugador
      // estaría sesgado — por equipo es el dato honesto.
      db.query<{
        team_id: string;
        team_short: string | null;
        team_name: string | null;
        fd_total: string; fd_scored: string;
        pen_total: string; pen_scored: string;
      }>(`
        SELECT e.team_id,
               tm.short_name AS team_short, tm.name AS team_name,
               COUNT(*) FILTER (WHERE e.event_type = 'direct_foul')::text AS fd_total,
               COUNT(*) FILTER (WHERE e.event_type = 'direct_foul' AND e.detail = 'marcada')::text AS fd_scored,
               COUNT(*) FILTER (WHERE e.event_type = 'penalty')::text AS pen_total,
               COUNT(*) FILTER (
                 WHERE e.event_type = 'penalty'
                   AND (e.detail ILIKE '%gol%' OR e.detail ILIKE '%marc%')
               )::text AS pen_scored
        FROM match_events e
        JOIN matches m ON m.id = e.match_id
        JOIN teams tm ON tm.id = e.team_id
        WHERE m.season_id = $1
          AND e.event_type IN ('direct_foul', 'penalty')
          AND e.team_id IS NOT NULL
        GROUP BY e.team_id, tm.short_name, tm.name
        ORDER BY COUNT(*) FILTER (WHERE e.event_type = 'direct_foul' AND e.detail = 'marcada') DESC
      `, [seasonId]),
    ]);

    const toLeader = (r: LeaderRow) => ({
      playerId:   r.player_id,
      playerName: r.player_name,
      photoUrl:   r.photo_url,
      teamId:     r.team_id,
      teamShort:  r.team_short,
      teamName:   r.team_name,
      value:      Number(r.value),
      extra:      Number(r.extra ?? 0),
    });

    const pct = (scored: number, total: number) =>
      total > 0 ? Math.round((scored / total) * 100) : null;

    return c.json({
      topScorers: scorers.rows.map(toLeader),  // value=goles, extra=asistencias
      topAssists: assists.rows.map(toLeader),  // value=asistencias, extra=goles
      topCards:   cards.rows.map(toLeader),    // value=azules, extra=rojas
      setPieces:  setPieces.rows.map((r) => {
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
    console.error('[season-stats] GET /:id/stats error:', err);
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: 'Database error' }, 500);
  }
});

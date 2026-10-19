import { Hono } from 'hono';
import { db } from '@sports/db';
import { isUuid } from '../lib/uuid.js';
import { captureRouteError } from '../lib/route-error.js';
import { penaltyScoredSql } from '../lib/penalty-sql.js';
import { buildPlayerPercentiles, type PeerPlayer } from '../lib/player-percentiles.js';

export const playerInsightsRouter = new Hono();

interface SeasonRow {
  id: string;
  name: string;
  competition_name: string;
  start_date: Date | null;
}

interface PeerRow {
  player_id: string;
  pj: string;
  goals: string;
  assists: string;
  penalties_total: string;
  penalties_scored: string;
}

/**
 * GET /players/:id/insights (C6)
 * Percentiles del jugador frente a los jugadores con actividad suficiente de
 * la última temporada en la que tiene muestra (>= 5 partidos). Sin texto: la
 * web pone la frase y el nombre del jugador.
 */
playerInsightsRouter.get('/:id/insights', async (c) => {
  const playerId = c.req.param('id');
  if (!isUuid(playerId)) return c.json({ error: 'Not found' }, 404);

  try {
    const seasonRes = await db.query<SeasonRow>(`
      WITH actividad AS (
        SELECT ml.player_id, ml.match_id, m.season_id
          FROM match_lineups ml JOIN matches m ON m.id = ml.match_id
         WHERE ml.player_id = $1 AND ml.role IS NULL AND m.status = 'finished'
        UNION
        SELECT me.player_id, me.match_id, m.season_id
          FROM match_events me JOIN matches m ON m.id = me.match_id
         WHERE me.player_id = $1 AND m.status = 'finished'
      ), por_temporada AS (
        SELECT season_id, COUNT(DISTINCT match_id)::int AS pj
          FROM actividad
         GROUP BY season_id
      )
      SELECT s.id, s.name, c.name AS competition_name, s.start_date
        FROM por_temporada p
        JOIN seasons s ON s.id = p.season_id
        JOIN competitions c ON c.id = s.competition_id
       WHERE p.pj >= 5 AND s.data_quality = 'ok' AND c.data_quality = 'ok'
       ORDER BY s.start_date DESC NULLS LAST
       LIMIT 1
    `, [playerId]);

    const season = seasonRes.rows[0];
    if (!season) return c.json({ playerId, season: null, metrics: [] });

    const peersRes = await db.query<PeerRow>(`
      WITH pj AS (
        SELECT player_id, COUNT(DISTINCT match_id)::int AS pj
          FROM (
            SELECT ml.player_id, ml.match_id
              FROM match_lineups ml JOIN matches m ON m.id = ml.match_id
             WHERE m.season_id = $1 AND m.status = 'finished'
               AND ml.player_id IS NOT NULL AND ml.role IS NULL
            UNION
            SELECT me.player_id, me.match_id
              FROM match_events me JOIN matches m ON m.id = me.match_id
             WHERE m.season_id = $1 AND m.status = 'finished'
               AND me.player_id IS NOT NULL
          ) x
         GROUP BY player_id
      ), asistencias AS (
        SELECT ml.player_id, SUM(COALESCE(ml.assists, 0))::int AS assists
          FROM match_lineups ml JOIN matches m ON m.id = ml.match_id
         WHERE m.season_id = $1 AND m.status = 'finished'
           AND ml.player_id IS NOT NULL AND ml.role IS NULL
         GROUP BY ml.player_id
      ), eventos AS (
        SELECT me.player_id,
               COUNT(*) FILTER (WHERE me.event_type = 'goal') AS goals,
               COUNT(*) FILTER (WHERE me.event_type = 'penalty') AS penalties_total,
               COUNT(*) FILTER (
                 WHERE me.event_type = 'penalty' AND ${penaltyScoredSql('me')}
               ) AS penalties_scored
          FROM match_events me JOIN matches m ON m.id = me.match_id
         WHERE m.season_id = $1 AND m.status = 'finished'
           AND me.player_id IS NOT NULL
         GROUP BY me.player_id
      )
      SELECT p.player_id, p.pj::text,
             COALESCE(e.goals, 0)::text           AS goals,
             COALESCE(a.assists, 0)::text         AS assists,
             COALESCE(e.penalties_total, 0)::text AS penalties_total,
             COALESCE(e.penalties_scored, 0)::text AS penalties_scored
        FROM pj p
        LEFT JOIN asistencias a ON a.player_id = p.player_id
        LEFT JOIN eventos e     ON e.player_id = p.player_id
       WHERE p.pj >= 5
    `, [season.id]);

    const peers: PeerPlayer[] = peersRes.rows.map((r) => ({
      playerId: r.player_id,
      pj: Number(r.pj),
      goals: Number(r.goals),
      assists: Number(r.assists),
      penaltiesTotal: Number(r.penalties_total),
      penaltiesScored: Number(r.penalties_scored),
    }));

    const [teamRes, playerMatchesRes] = await Promise.all([
      db.query<{ team_id: string }>(`
        SELECT team_id
          FROM (
            SELECT ml.team_id
              FROM match_lineups ml JOIN matches m ON m.id = ml.match_id
             WHERE ml.player_id = $1 AND ml.role IS NULL
               AND m.season_id = $2 AND m.status = 'finished'
            UNION ALL
            SELECT me.team_id
              FROM match_events me JOIN matches m ON m.id = me.match_id
             WHERE me.player_id = $1 AND me.team_id IS NOT NULL
               AND m.season_id = $2 AND m.status = 'finished'
          ) x
         GROUP BY team_id
         ORDER BY COUNT(*) DESC
         LIMIT 1`, [playerId, season.id]),
      db.query<{ match_id: string; goals: number }>(`
        SELECT me.match_id, COUNT(*) FILTER (WHERE me.event_type = 'goal')::int AS goals
          FROM match_events me JOIN matches m ON m.id = me.match_id
         WHERE me.player_id = $1 AND m.season_id = $2 AND m.status = 'finished'
         GROUP BY me.match_id`, [playerId, season.id]),
    ]);

    const teamId = teamRes.rows[0]?.team_id ?? null;
    const teamGoalsRes = teamId
      ? await db.query<{ goals: number }>(`
          SELECT COUNT(*)::int AS goals
            FROM match_events me JOIN matches m ON m.id = me.match_id
           WHERE me.team_id = $1 AND m.season_id = $2 AND m.status = 'finished'
             AND me.event_type = 'goal'`, [teamId, season.id])
      : { rows: [] as Array<{ goals: number }> };

    const playerRow = peers.find((p) => p.playerId === playerId);
    const goals = playerRow?.goals ?? 0;
    const teamGoals = teamGoalsRes.rows[0]?.goals ?? null;
    const scorerRank = playerRow ? 1 + peers.filter((p) => p.goals > goals).length : null;

    // Racha actual y hat-tricks: los partidos vienen sin fecha en el agregado,
    // pero la consulta de rachas necesita el orden. Se resuelve con el id de
    // partido y la fecha de `matches` en una segunda consulta pequeña.
    const matchIds = playerMatchesRes.rows.map((r) => r.match_id);
    const datesRes = matchIds.length
      ? await db.query<{ id: string; date: Date | null }>(`
          SELECT id, COALESCE(finished_at, scheduled_at) AS date
            FROM matches WHERE id = ANY($1::uuid[])`, [matchIds])
      : { rows: [] as Array<{ id: string; date: Date | null }> };
    const dateById = new Map(datesRes.rows.map((r) => [r.id, r.date ? new Date(r.date).getTime() : 0]));
    const goalMatches = playerMatchesRes.rows
      .map((r) => ({ goals: r.goals, at: dateById.get(r.match_id) ?? 0 }))
      .sort((a, b) => b.at - a.at);
    let scoringStreak = 0;
    for (const m of goalMatches) {
      if (m.goals <= 0) break;
      scoringStreak++;
    }
    const hatTricks = goalMatches.filter((m) => m.goals >= 3).length;

    return c.json({
      playerId,
      season: {
        id: season.id,
        name: season.name,
        competitionName: season.competition_name,
        startDate: season.start_date ? new Date(season.start_date).toISOString() : null,
      },
      metrics: buildPlayerPercentiles(playerId, peers),
      facts: {
        goals,
        teamGoals,
        goalSharePct: teamGoals && teamGoals > 0 ? Math.round((goals / teamGoals) * 100) : null,
        scorerRank,
        scoringStreak,
        hatTricks,
      },
    });
  } catch (err) {
    captureRouteError(err, 'GET /players/:id/insights');
    return c.json({ error: 'Database error' }, 500);
  }
});

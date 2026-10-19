import { Hono } from 'hono';
import { db } from '@sports/db';
import { logger } from '@sports/logger';
import { isUuid } from '../lib/uuid.js';
import { seasonVisible } from '../lib/visibility.js';
import { captureRouteError } from '../lib/route-error.js';
import { penaltyScoredSql } from '../lib/penalty-sql.js';
import { setBounded } from '../lib/bounded-cache.js';
import { computeSeasonInsights, type Insight, type InsightInput } from '../lib/insights.js';

export const seasonInsightsRouter = new Hono();

/**
 * GET /seasons/:id/insights (C2) — datos de la temporada que superan su umbral,
 * ya ordenados por interés, con las entidades que citan para enlazarlas.
 * Sin texto: la web pone la frase en cada idioma (lib/insights).
 */
export interface SeasonInsightsResponse {
  insights: Insight[];
  teams: Record<string, { name: string; shortName: string | null }>;
  players: Record<string, { firstName: string; lastName: string }>;
  matches: Record<string, { homeTeamId: string; awayTeamId: string; date: string | null }>;
}

const TTL_MS = 10 * 60_000;
const MAX_ENTRIES = 300;
const cache = new Map<string, { at: number; body: SeasonInsightsResponse }>();

export async function loadSeasonInsights(seasonId: string): Promise<SeasonInsightsResponse> {
  const [matches, goals, setPieces, cards, scorers, pending] = await Promise.all([
    db.query<{
      id: string; date: Date | null; home_team_id: string; away_team_id: string;
      home_score: number; away_score: number; league: boolean; full_events: boolean;
    }>(`
      SELECT m.id, COALESCE(m.started_at, m.scheduled_at) AS date,
             m.home_team_id, m.away_team_id, m.home_score, m.away_score,
             (ph.kind IN ('league', 'groups')
               OR (ph.id IS NULL AND COALESCE(r.round_type, 'regular') = 'regular')) AS league,
             (m.event_coverage = 'full') AS full_events
        FROM matches m
        LEFT JOIN phases ph ON ph.id = m.phase_id
        LEFT JOIN rounds r  ON r.id = m.round_id
       WHERE m.season_id = $1 AND m.status = 'finished'
         AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL`, [seasonId]),
    db.query<{ match_id: string; team_id: string; period: number | null; minute: number | null }>(`
      SELECT e.match_id, e.team_id, e.period, e.minute
        FROM match_events e JOIN matches m ON m.id = e.match_id
       WHERE m.season_id = $1 AND m.status = 'finished'
         AND e.event_type = 'goal' AND e.team_id IS NOT NULL`, [seasonId]),
    db.query<{ match_id: string; team_id: string; kind: 'penalty' | 'direct_foul'; scored: boolean }>(`
      SELECT e.match_id, e.team_id, e.event_type AS kind,
             CASE WHEN e.event_type = 'penalty' THEN ${penaltyScoredSql('e')}
                  ELSE e.detail = 'marcada' END AS scored
        FROM match_events e JOIN matches m ON m.id = e.match_id
       WHERE m.season_id = $1 AND m.status = 'finished'
         AND e.event_type IN ('penalty', 'direct_foul') AND e.team_id IS NOT NULL`, [seasonId]),
    db.query<{ match_id: string; team_id: string; kind: 'blue_card' | 'red_card' }>(`
      SELECT e.match_id, e.team_id, e.event_type AS kind
        FROM match_events e JOIN matches m ON m.id = e.match_id
       WHERE m.season_id = $1 AND m.status = 'finished'
         AND e.event_type IN ('blue_card', 'red_card') AND e.team_id IS NOT NULL`, [seasonId]),
    db.query<{ player_id: string; team_id: string; goals: number }>(`
      SELECT ml.player_id,
             CASE WHEN ml.is_home THEN m.home_team_id ELSE m.away_team_id END AS team_id,
             SUM(ml.goals)::int AS goals
        FROM match_lineups ml JOIN matches m ON m.id = ml.match_id
       WHERE m.season_id = $1 AND ml.player_id IS NOT NULL AND ml.role IS NULL
       GROUP BY ml.player_id, 2
      HAVING SUM(ml.goals) > 0`, [seasonId]),
    db.query<{ n: number }>(`
      SELECT count(*)::int AS n FROM matches
       WHERE season_id = $1 AND status IN ('scheduled', 'live', 'halftime', 'overtime', 'penalty_shootout')`, [seasonId]),
  ]);

  const input: InsightInput = {
    teams: [],
    matches: matches.rows.map((r) => ({
      id: r.id, date: r.date ? new Date(r.date).toISOString() : null,
      homeTeamId: r.home_team_id, awayTeamId: r.away_team_id,
      homeScore: r.home_score, awayScore: r.away_score, league: r.league, fullEvents: r.full_events,
    })),
    goals: goals.rows.map((r) => ({ matchId: r.match_id, teamId: r.team_id, period: r.period, minute: r.minute })),
    setPieces: setPieces.rows.map((r) => ({ matchId: r.match_id, teamId: r.team_id, kind: r.kind, scored: r.scored })),
    cards: cards.rows.map((r) => ({ matchId: r.match_id, teamId: r.team_id, kind: r.kind })),
    scorers: scorers.rows.map((r) => ({ playerId: r.player_id, teamId: r.team_id, goals: r.goals })),
    seasonFinished: matches.rows.length > 0 && (pending.rows[0]?.n ?? 0) === 0,
  };
  const insights = computeSeasonInsights(input);

  // Diccionario de lo que se cita: nombres para la frase, ids para el enlace.
  const teamIds = [...new Set(insights.flatMap((i) => i.teamIds))];
  const playerIds = [...new Set(insights.flatMap((i) => i.playerIds))];
  const [teams, players] = await Promise.all([
    teamIds.length
      ? db.query<{ id: string; name: string; short_name: string | null }>(
          `SELECT id, name, short_name FROM teams WHERE id = ANY($1::uuid[])`, [teamIds])
      : Promise.resolve({ rows: [] }),
    playerIds.length
      ? db.query<{ id: string; first_name: string; last_name: string }>(
          `SELECT id, first_name, last_name FROM players WHERE id = ANY($1::uuid[])`, [playerIds])
      : Promise.resolve({ rows: [] }),
  ]);
  const matchById = new Map(input.matches.map((m) => [m.id, m]));

  return {
    insights,
    teams: Object.fromEntries(teams.rows.map((t) => [t.id, { name: t.name, shortName: t.short_name }])),
    players: Object.fromEntries(players.rows.map((p) => [p.id, { firstName: p.first_name, lastName: p.last_name }])),
    matches: Object.fromEntries(insights.filter((i) => i.matchId).map((i) => {
      const m = matchById.get(i.matchId!)!;
      return [m.id, { homeTeamId: m.homeTeamId, awayTeamId: m.awayTeamId, date: m.date }];
    })),
  };
}

seasonInsightsRouter.get('/:id/insights', async (c) => {
  const seasonId = c.req.param('id');
  if (!isUuid(seasonId)) return c.json({ error: 'Not found' }, 404);
  if (!(await seasonVisible(seasonId))) return c.json({ error: 'Not found' }, 404);

  const hit = cache.get(seasonId);
  if (hit && Date.now() - hit.at < TTL_MS) return c.json(hit.body);

  try {
    const body = await loadSeasonInsights(seasonId);
    setBounded(cache, seasonId, { at: Date.now(), body }, MAX_ENTRIES);
    return c.json(body);
  } catch (err) {
    captureRouteError(err, 'GET /seasons/:id/insights');
    logger.error({ err, seasonId }, 'Error calculando insights de temporada');
    return c.json({ error: 'Internal error' }, 500);
  }
});

import { Hono } from 'hono';
import { db } from '@sports/db';

export const teamDetailRouter = new Hono();

interface TeamRow {
  id: string;
  name: string;
  short_name: string | null;
  city: string | null;
  country: string;
  logo_url: string | null;
  website_url: string | null;
}

interface StandingRow {
  season_id: string;
  competition_id: string;
  competition_name: string;
  competition_short_name: string | null;
  position: number | null;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goals_for: number;
  goals_against: number;
  goal_diff: number;
  points: number;
  form: string[] | null;
  penalization_points: number | null;
}

interface MatchRow {
  id: string;
  status: string;
  scheduled_at: Date | null;
  started_at: Date | null;
  finished_at: Date | null;
  home_score: number | null;
  away_score: number | null;
  venue_name: string | null;
  venue_city: string | null;
  home_team_id: string;
  home_team_name: string;
  home_team_short_name: string | null;
  home_team_logo_url: string | null;
  away_team_id: string;
  away_team_name: string;
  away_team_short_name: string | null;
  away_team_logo_url: string | null;
}

interface SquadRow {
  player_id: string;
  first_name: string;
  last_name: string;
  position: string | null;
  photo_url: string | null;
  jersey_number: number | null;
  goals: string;
  blue_cards: string;
  red_cards: string;
  penalties: string;
}

/**
 * GET /teams/:id
 * Devuelve: datos del club, standing actual, partidos de temporada, plantilla con stats.
 */
teamDetailRouter.get('/:id', async (c) => {
  const id = c.req.param('id');

  try {
    // 1) Info del equipo
    const teamRes = await db.query<TeamRow>(
      `SELECT id, name, short_name, city, country, logo_url, website_url
       FROM teams WHERE id = $1`,
      [id]
    );
    if (teamRes.rows.length === 0) return c.json({ error: 'Team not found' }, 404);
    const teamRow = teamRes.rows[0]!;

    // 2) Standing + nombre de competición (temporada activa)
    const standingRes = await db.query<StandingRow>(`
      SELECT
        s.season_id,
        se.competition_id,
        c.name          AS competition_name,
        c.short_name    AS competition_short_name,
        s.position,
        s.played,   s.won,   s.drawn,   s.lost,
        s.goals_for, s.goals_against, s.goal_diff,
        s.points,   s.form,
        s.penalization_points
      FROM standings s
      JOIN seasons se ON se.id = s.season_id
      JOIN competitions c ON c.id = se.competition_id
      WHERE s.team_id = $1
        AND se.is_current = TRUE
      ORDER BY s.points DESC
      LIMIT 1
    `, [id]);

    const standingRow = standingRes.rows[0] ?? null;

    // Temporadas activas del equipo — desde season_teams, NO desde standings.
    // Las eliminatorias (playoff) no tienen clasificación y dejaban la ficha
    // del equipo sin partidos ni plantilla.
    const seasonsRes = await db.query<{ season_id: string }>(`
      SELECT st.season_id
      FROM season_teams st
      JOIN seasons se ON se.id = st.season_id
      WHERE st.team_id = $1 AND se.is_current = TRUE
    `, [id]);
    const currentSeasonIds = seasonsRes.rows.map((r) => r.season_id);
    if (standingRow && !currentSeasonIds.includes(standingRow.season_id)) {
      currentSeasonIds.push(standingRow.season_id);
    }

    // 3) Partidos de las temporadas activas donde participa el equipo
    let matchRows: MatchRow[] = [];
    if (currentSeasonIds.length > 0) {
      const matchRes = await db.query<MatchRow>(`
        SELECT
          m.id, m.status, m.scheduled_at, m.started_at, m.finished_at,
          m.home_score, m.away_score,
          m.venue_name, m.venue_city,
          ht.id           AS home_team_id,
          ht.name         AS home_team_name,
          ht.short_name   AS home_team_short_name,
          ht.logo_url     AS home_team_logo_url,
          at.id           AS away_team_id,
          at.name         AS away_team_name,
          at.short_name   AS away_team_short_name,
          at.logo_url     AS away_team_logo_url
        FROM matches m
        LEFT JOIN teams ht ON ht.id = m.home_team_id
        LEFT JOIN teams at ON at.id = m.away_team_id
        WHERE m.season_id = ANY($1)
          AND (m.home_team_id = $2 OR m.away_team_id = $2)
        ORDER BY m.scheduled_at ASC NULLS LAST
      `, [currentSeasonIds, id]);
      matchRows = matchRes.rows;
    }

    // 4) Plantilla con stats agregadas de match_events (temporadas activas)
    let squadRows: SquadRow[] = [];
    if (currentSeasonIds.length > 0) {
      const squadRes = await db.query<SquadRow>(`
        SELECT
          p.id            AS player_id,
          p.first_name,
          p.last_name,
          p.position,
          p.photo_url,
          tp.jersey_number,
          COUNT(DISTINCT me_g.id)  FILTER (WHERE me_g.event_type = 'goal')       AS goals,
          COUNT(DISTINCT me_b.id)  FILTER (WHERE me_b.event_type = 'blue_card')  AS blue_cards,
          COUNT(DISTINCT me_r.id)  FILTER (WHERE me_r.event_type = 'red_card')   AS red_cards,
          COUNT(DISTINCT me_p.id)  FILTER (WHERE me_p.event_type = 'penalty')    AS penalties
        FROM team_players tp
        JOIN players p ON p.id = tp.player_id
        -- Agregados desde match_events (LEFT JOIN para no excluir jugadores sin eventos)
        LEFT JOIN match_events me_g ON me_g.player_id = p.id
          AND me_g.event_type = 'goal'
          AND EXISTS (SELECT 1 FROM matches mx WHERE mx.id = me_g.match_id AND mx.season_id = ANY($1))
        LEFT JOIN match_events me_b ON me_b.player_id = p.id
          AND me_b.event_type = 'blue_card'
          AND EXISTS (SELECT 1 FROM matches mx WHERE mx.id = me_b.match_id AND mx.season_id = ANY($1))
        LEFT JOIN match_events me_r ON me_r.player_id = p.id
          AND me_r.event_type = 'red_card'
          AND EXISTS (SELECT 1 FROM matches mx WHERE mx.id = me_r.match_id AND mx.season_id = ANY($1))
        LEFT JOIN match_events me_p ON me_p.player_id = p.id
          AND me_p.event_type = 'penalty'
          AND EXISTS (SELECT 1 FROM matches mx WHERE mx.id = me_p.match_id AND mx.season_id = ANY($1))
        WHERE tp.team_id = $2
          AND tp.season_id = ANY($1)
          AND tp.is_active = TRUE
        GROUP BY p.id, p.first_name, p.last_name, p.position, p.photo_url, tp.jersey_number
        ORDER BY
          CASE WHEN p.position = 'portero' THEN 0 ELSE 1 END,
          tp.jersey_number NULLS LAST,
          p.last_name
      `, [currentSeasonIds, id]);
      squadRows = squadRes.rows;
    }

    // 4b) Cuerpo técnico — del partido más reciente con acta procesada
    let staff: Array<{ name: string; role: string }> = [];
    if (currentSeasonIds.length > 0) {
      const staffRes = await db.query<{ player_name: string; role: string }>(`
        SELECT DISTINCT ON (ml.player_name) ml.player_name, ml.role
        FROM match_lineups ml
        JOIN matches m ON m.id = ml.match_id
        WHERE m.season_id = ANY($1)
          AND ((ml.is_home AND m.home_team_id = $2) OR (NOT ml.is_home AND m.away_team_id = $2))
          AND ml.role IS NOT NULL
        ORDER BY ml.player_name, m.scheduled_at DESC
      `, [currentSeasonIds, id]);
      const ROLE_ORDER: Record<string, number> = { E1: 0, E: 0, E2: 1, A: 2, D: 3 };
      staff = staffRes.rows
        .map((r) => ({ name: r.player_name, role: r.role }))
        .sort((a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9));
    }

    // 5) Estadísticas propias del equipo (temporadas activas)
    let teamStats: Record<string, unknown> | null = null;
    if (currentSeasonIds.length > 0) {
      const [resultsRes, eventsRes, lineupRes] = await Promise.all([
        // Resultados y faltas de equipo desde matches
        db.query<{
          played: string; won: string; drawn: string; lost: string;
          gf: string | null; ga: string | null; fouls: string | null;
        }>(`
          SELECT
            COUNT(*)::text AS played,
            COUNT(*) FILTER (
              WHERE (home_team_id = $2 AND home_score > away_score)
                 OR (away_team_id = $2 AND away_score > home_score)
            )::text AS won,
            COUNT(*) FILTER (WHERE home_score = away_score)::text AS drawn,
            COUNT(*) FILTER (
              WHERE (home_team_id = $2 AND home_score < away_score)
                 OR (away_team_id = $2 AND away_score < home_score)
            )::text AS lost,
            SUM(CASE WHEN home_team_id = $2 THEN home_score ELSE away_score END)::text AS gf,
            SUM(CASE WHEN home_team_id = $2 THEN away_score ELSE home_score END)::text AS ga,
            SUM(CASE WHEN home_team_id = $2 THEN home_fouls ELSE away_fouls END)::text AS fouls
          FROM matches
          WHERE season_id = ANY($1)
            AND (home_team_id = $2 OR away_team_id = $2)
            AND status = 'finished'
        `, [currentSeasonIds, id]),
        // Disciplina y bola parada desde match_events
        db.query<{
          blue: string; red: string; timeouts: string;
          fd_total: string; fd_scored: string;
          pen_total: string; pen_scored: string;
        }>(`
          SELECT
            COUNT(*) FILTER (WHERE e.event_type = 'blue_card')::text AS blue,
            COUNT(*) FILTER (WHERE e.event_type = 'red_card')::text  AS red,
            COUNT(*) FILTER (WHERE e.event_type = 'timeout')::text   AS timeouts,
            COUNT(*) FILTER (WHERE e.event_type = 'direct_foul')::text AS fd_total,
            COUNT(*) FILTER (WHERE e.event_type = 'direct_foul' AND e.detail = 'marcada')::text AS fd_scored,
            COUNT(*) FILTER (WHERE e.event_type = 'penalty')::text AS pen_total,
            COUNT(*) FILTER (
              WHERE e.event_type = 'penalty' AND (e.detail ILIKE '%gol%' OR e.detail ILIKE '%marc%')
            )::text AS pen_scored
          FROM match_events e
          JOIN matches m ON m.id = e.match_id
          WHERE m.season_id = ANY($1) AND e.team_id = $2
        `, [currentSeasonIds, id]),
        // Asistencias desde las alineaciones
        db.query<{ assists: string | null }>(`
          SELECT SUM(ml.assists)::text AS assists
          FROM match_lineups ml
          JOIN matches m ON m.id = ml.match_id
          WHERE m.season_id = ANY($1)
            AND ((ml.is_home AND m.home_team_id = $2) OR (NOT ml.is_home AND m.away_team_id = $2))
        `, [currentSeasonIds, id]),
      ]);

      const r = resultsRes.rows[0]!;
      const e = eventsRes.rows[0]!;
      const pct = (scored: number, total: number) =>
        total > 0 ? Math.round((scored / total) * 100) : null;
      const fdTotal = Number(e.fd_total), fdScored = Number(e.fd_scored);
      const penTotal = Number(e.pen_total), penScored = Number(e.pen_scored);

      teamStats = {
        played:       Number(r.played),
        won:          Number(r.won),
        drawn:        Number(r.drawn),
        lost:         Number(r.lost),
        goalsFor:     Number(r.gf ?? 0),
        goalsAgainst: Number(r.ga ?? 0),
        assists:      Number(lineupRes.rows[0]?.assists ?? 0),
        teamFouls:    Number(r.fouls ?? 0),
        blueCards:    Number(e.blue),
        redCards:     Number(e.red),
        timeouts:     Number(e.timeouts),
        directFouls:  { total: fdTotal, scored: fdScored, pct: pct(fdScored, fdTotal) },
        penalties:    { total: penTotal, scored: penScored, pct: pct(penScored, penTotal) },
      };
    }

    // ─── Serialización ────────────────────────────────────────────────────────

    const team = {
      id:         teamRow.id,
      name:       teamRow.name,
      shortName:  teamRow.short_name,
      city:       teamRow.city,
      country:    teamRow.country,
      logoUrl:    teamRow.logo_url,
      websiteUrl: teamRow.website_url,
    };

    const standing = standingRow ? {
      seasonId:          standingRow.season_id,
      competitionId:     standingRow.competition_id,
      competitionName:   standingRow.competition_name,
      competitionShort:  standingRow.competition_short_name,
      position:          standingRow.position,
      played:            standingRow.played,
      won:               standingRow.won,
      drawn:             standingRow.drawn,
      lost:              standingRow.lost,
      goalsFor:          standingRow.goals_for,
      goalsAgainst:      standingRow.goals_against,
      goalDiff:          standingRow.goal_diff,
      points:            standingRow.points,
      form:              standingRow.form ?? [],
      penalizationPoints: standingRow.penalization_points ?? 0,
    } : null;

    const matches = matchRows.map((m) => ({
      id:          m.id,
      status:      m.status,
      scheduledAt: m.scheduled_at,
      startedAt:   m.started_at,
      finishedAt:  m.finished_at,
      score:       { home: m.home_score, away: m.away_score },
      venue:       m.venue_name ? { name: m.venue_name, city: m.venue_city } : null,
      homeTeam: {
        id:        m.home_team_id,
        name:      m.home_team_name,
        shortName: m.home_team_short_name,
        logoUrl:   m.home_team_logo_url,
      },
      awayTeam: {
        id:        m.away_team_id,
        name:      m.away_team_name,
        shortName: m.away_team_short_name,
        logoUrl:   m.away_team_logo_url,
      },
    }));

    const squad = squadRows.map((p) => ({
      playerId:     p.player_id,
      firstName:    p.first_name,
      lastName:     p.last_name,
      photoUrl:     p.photo_url,
      position:     p.position,
      jerseyNumber: p.jersey_number,
      goals:        Number(p.goals),
      blueCards:    Number(p.blue_cards),
      redCards:     Number(p.red_cards),
      penalties:    Number(p.penalties),
    }));

    return c.json({ team, standing, matches, squad, staff, stats: teamStats });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ error: 'Database error', detail: message }, 500);
  }
});

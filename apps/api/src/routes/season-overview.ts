import { Hono } from 'hono';
import { db } from '@sports/db';
import { logger } from '@sports/logger';
import { isUuid } from '../lib/uuid.js';
import { captureRouteError } from '../lib/route-error.js';
import { buildSeasonStructure, type StructurePhaseRow } from '../lib/season-structure.js';

export const seasonOverviewRouter = new Hono();

interface SeasonRow {
  id: string;
  name: string;
  season_slug: string;
  start_date: Date | null;
  end_date: Date | null;
  competition_id: string;
  competition_name: string;
  competition_slug: string;
  competition_name_i18n: Record<string, string> | null;
  competition_short_name: string | null;
  competition_logo_url: string | null;
  competition_organizer: string;
  competition_scope: string;
  competition_country: string | null;
  competition_region: string | null;
  competition_timezone: string | null;
  /** Formato declarado en competition_sources.external_ids.format (#166):
   *  'league' | 'bracket' | 'final_four'. NULL/vacío ⇒ liga. */
  competition_format: string | null;
}

interface StandingRow {
  id: string;
  team_id: string;
  team_name: string;
  team_short_name: string | null;
  team_logo_url: string | null;
  group_name: string | null;
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

interface RoundRow {
  id: string;
  number: number;
  name: string | null;
  round_type: string;
  phase_id: string | null;
  stage: string | null;
}

interface MatchRow {
  id: string;
  status: string;
  scheduled_at: Date | null;
  started_at: Date | null;
  finished_at: Date | null;
  home_score: number | null;
  away_score: number | null;
  winner_team_id: string | null;
  win_type: string | null;
  home_pen: number | null;
  away_pen: number | null;
  venue_name: string | null;
  round_id: string | null;
  phase_id: string | null;
  series_game: number | null;
  round_number: number | null;
  round_name: string | null;
  round_type: string | null;
  group_name: string | null;
  home_team_id: string;
  home_team_name: string;
  home_team_short_name: string | null;
  home_team_logo_url: string | null;
  away_team_id: string;
  away_team_name: string;
  away_team_short_name: string | null;
  away_team_logo_url: string | null;
}

/**
 * GET /seasons/:id/overview
 * Devuelve en un único payload: metadata de la temporada, clasificación
 * completa, lista de jornadas y todos los partidos (regular + playoffs).
 */
seasonOverviewRouter.get('/:id/overview', async (c) => {
  const seasonId = c.req.param('id');

  // Un id no-UUID haría fallar el cast a uuid de Postgres y devolvería 500
  // (enlace corrupto/bot) en vez de 404 (#275).
  if (!isUuid(seasonId)) return c.json({ error: 'Not found' }, 404);

  try {
    // #333: las cuatro queries sólo dependen de seasonId y son independientes
    // (metadata, clasificación, jornadas, partidos). En serie sumaban cuatro
    // round-trips; en paralelo el payload tarda el máximo. Si la temporada no
    // existe, las demás devuelven vacío y se responde 404 igualmente.
    const [seasonRes, standingsRes, roundsRes, matchesRes, phasesRes] = await Promise.all([
      // 1) Season + competition info
      db.query<SeasonRow>(`
        SELECT s.id, s.name, s.slug AS season_slug, s.start_date, s.end_date,
               c.id         AS competition_id,
               c.name       AS competition_name,
               c.slug       AS competition_slug,
               c.name_i18n  AS competition_name_i18n,
               c.short_name AS competition_short_name,
               c.logo_url   AS competition_logo_url,
               c.organizer  AS competition_organizer,
               c.scope      AS competition_scope,
               c.country    AS competition_country,
               c.region     AS competition_region,
               c.timezone   AS competition_timezone,
               cs.external_ids->>'format' AS competition_format
        FROM seasons s
        JOIN competitions c ON c.id = s.competition_id
        LEFT JOIN competition_sources cs ON cs.competition_id = c.id
        WHERE s.id = $1
          AND s.data_quality = 'ok'
          AND c.data_quality = 'ok'
      `, [seasonId]),

      // 2) Standings con info de equipo
      db.query<StandingRow>(`
        SELECT
          st.id, st.team_id,
          COALESCE(t.display_name, t.name) AS team_name,
          t.short_name   AS team_short_name,
          t.logo_url     AS team_logo_url,
          st.group_name, st.position,
          st.played, st.won, st.drawn, st.lost,
          st.goals_for, st.goals_against, st.goal_diff,
          st.points, st.form,
          st.penalization_points
        FROM (
          -- Defensa contra duplicados históricos: una fila por equipo,
          -- la más reciente (el unique con COALESCE(group_name,'') lo
          -- impide a futuro, pero los datos viejos pueden traer restos).
          -- Una fila por equipo, la más reciente. Si algún día hay grupos
          -- reales (A/B), la UI necesitará tratamiento propio de grupos y
          -- este DISTINCT deberá incluir group_name.
          SELECT DISTINCT ON (team_id) *
          FROM standings
          WHERE season_id = $1
          ORDER BY team_id, scraped_at DESC NULLS LAST, created_at DESC
        ) st
        JOIN teams t ON t.id = st.team_id
        ORDER BY st.position NULLS LAST, st.points DESC, st.goal_diff DESC
      `, [seasonId]),

      // 3) Rounds (para selector de jornadas), en el orden de sus fases
      db.query<RoundRow>(`
        SELECT r.id, r.number, r.name, r.round_type, r.phase_id, r.stage
        FROM rounds r
        LEFT JOIN phases p ON p.id = r.phase_id
        WHERE r.season_id = $1
        ORDER BY
          COALESCE(p.ordinal, 0),
          CASE r.round_type WHEN 'regular' THEN 0 WHEN 'playoff' THEN 1 ELSE 2 END,
          r.number ASC
      `, [seasonId]),

      // 4) Todos los partidos con equipos
      db.query<MatchRow>(`
        SELECT
          m.id, m.status, m.scheduled_at, m.started_at, m.finished_at,
          m.home_score, m.away_score, m.winner_team_id, m.win_type, m.home_pen, m.away_pen, m.venue_name, m.round_id,
          m.group_name, m.phase_id, m.series_game,
          r.number       AS round_number,
          r.name         AS round_name,
          r.round_type,
          ht.id          AS home_team_id,
          COALESCE(ht.display_name, ht.name) AS home_team_name,
          ht.short_name  AS home_team_short_name,
          ht.logo_url    AS home_team_logo_url,
          at.id          AS away_team_id,
          COALESCE(at.display_name, at.name) AS away_team_name,
          at.short_name  AS away_team_short_name,
          at.logo_url    AS away_team_logo_url
        FROM matches m
        LEFT JOIN rounds r ON r.id = m.round_id
        LEFT JOIN teams ht ON ht.id = m.home_team_id
        LEFT JOIN teams at ON at.id = m.away_team_id
        WHERE m.season_id = $1
        ORDER BY
          CASE COALESCE(r.round_type,'regular') WHEN 'regular' THEN 0 WHEN 'playoff' THEN 1 ELSE 2 END,
          COALESCE(r.number, 0),
          m.scheduled_at ASC NULLS LAST
      `, [seasonId]),

      // 5) Fases de la temporada (migración 072)
      db.query<StructurePhaseRow>(`
        SELECT id, ordinal, kind, is_placement, name, resolved_by
        FROM phases
        WHERE season_id = $1
        ORDER BY ordinal, created_at
      `, [seasonId]),
    ]);

    if (seasonRes.rows.length === 0) return c.json({ error: 'Season not found' }, 404);
    const s = seasonRes.rows[0]!;

    // Estructura explícita (fases → rondas → partidos) guardada por el ETL desde
    // la fuente. Los campos legados (roundNumber 1/2/3/0, roundType,
    // competitionFormat) se calculan desde ella; ya no se deducen por el nombre
    // de la competición ni por la cronología (salvo datos heredados, aislado y
    // marcado con stageInferred — ver lib/season-structure).
    const structure = buildSeasonStructure({
      phases: phasesRes.rows,
      rounds: roundsRes.rows,
      matches: matchesRes.rows,
      hasStandings: standingsRes.rows.length > 0,
      declaredFormat: s.competition_format,
    });

    return c.json({
      season: {
        id:               s.id,
        name:             s.name,
        slug:             s.season_slug,
        startDate:        s.start_date,
        endDate:          s.end_date,
        competitionId:    s.competition_id,
        competitionName:  s.competition_name,
        competitionSlug:  s.competition_slug,
        competitionNameI18n: s.competition_name_i18n,
        competitionShort: s.competition_short_name,
        competitionLogoUrl: s.competition_logo_url,
        competitionOrganizer: s.competition_organizer,
        competitionScope:     s.competition_scope,
        competitionCountry:   s.competition_country,
        competitionRegion:    s.competition_region,
        competitionTimezone:  s.competition_timezone,
        // Formato legado ('league' | 'bracket' | 'final_four') para clientes que
        // aún no leen `phases`: derivado de las fases de la fuente.
        competitionFormat: structure.competitionFormat,
        // Secuencia de fases de la temporada (liga, grupos, eliminatoria,
        // colocación…). Una competición puede tener varias: liga + playoff,
        // grupos + final four… Cada una dice si lleva clasificación y qué
        // fases eliminatorias (cuartos, semis, final…) contiene.
        phases: structure.phases,
      },
      standings: standingsRes.rows.map((r) => ({
        id:                 r.id,
        teamId:             r.team_id,
        teamName:           r.team_name,
        teamShortName:      r.team_short_name,
        teamLogoUrl:        r.team_logo_url,
        groupName:          r.group_name,
        position:           r.position,
        played:             r.played,
        won:                r.won,
        drawn:              r.drawn,
        lost:               r.lost,
        goalsFor:           r.goals_for,
        goalsAgainst:       r.goals_against,
        goalDiff:           r.goal_diff,
        points:             r.points,
        form:               r.form ?? [],
        penalizationPoints: r.penalization_points ?? 0,
      })),
      rounds: roundsRes.rows.filter((r) => structure.visibleRoundIds.has(r.id)).map((r) => ({
        id:        r.id,
        number:    r.number,
        name:      r.name,
        roundType: r.round_type,
        phaseId:   r.phase_id,
        stage:     r.stage,
      })),
      matches: matchesRes.rows.map((m) => {
        const st = structure.byMatch.get(m.id)!;
        return {
          id:          m.id,
          status:      m.status,
          // Todos los partidos de la temporada son de la misma competición, así
          // que comparten su TZ (columna 042). Se pone por partido para que los
          // componentes lo consuman igual que en la home (patrón de #77).
          competitionTimezone: s.competition_timezone,
          scheduledAt: m.scheduled_at,
          startedAt:   m.started_at,
          finishedAt:  m.finished_at,
          score:       { home: m.home_score, away: m.away_score },
          winnerTeamId: m.winner_team_id,
          winType:      m.win_type,
          // Tanda de penaltis (null si no hubo): el cuadro explica un empate.
          penalties:    m.home_pen != null && m.away_pen != null ? { home: m.home_pen, away: m.away_pen } : null,
          venueName:   m.venue_name,
          roundId:     m.round_id,
          // Grupo de la fase de grupos ("A", "B"...): NULL en eliminatorias y
          // en competiciones sin grupos (ligas a partido único).
          groupName:   m.group_name,
          // Estructura del partido: fase, fase eliminatoria explícita y nº de
          // partido de la serie ("2 CUARTOS" → 2).
          phaseId:     st.phaseId,
          stage:       st.stage,
          seriesGame:  st.seriesGame,
          stageInferred: st.stageInferred,
          // Legado: jornada en liga/grupos; 1=QF/2=SF/3=F/0=colocación en
          // eliminatorias (desde `stage`).
          roundNumber: st.roundNumber,
          roundName:   m.round_name,
          roundType:   st.roundType,
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
        };
      }),
    }, 200);
  } catch (err) {
    captureRouteError(err, 'season-overview] GET /:id/overview error');
    logger.error({ err }, '[season-overview] GET /:id/overview error');
    return c.json({ error: 'Database error' }, 500);
  }
});

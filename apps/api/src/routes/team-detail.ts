import { Hono } from 'hono';
import { db } from '@sports/db';
import { logger } from '@sports/logger';
import { isUuid } from '../lib/uuid.js';
import { captureRouteError } from '../lib/route-error.js';
import { penaltyScoredSql } from '../lib/penalty-sql.js';
import { normalizeCompetitionFormat } from '../lib/competition-format.js';
import {
  buildSeasonStructure,
  type SeasonStructure,
  type StructureMatchRow,
  type StructurePhaseRow,
  type StructureRoundRow,
} from '../lib/season-structure.js';
import { orderClubTeams, sectionSuffix, type ClubTeamRow } from '../lib/team-section.js';

export const teamDetailRouter = new Hono();

interface TeamRow {
  id: string;
  name: string;
  short_name: string | null;
  city: string | null;
  country: string;
  logo_url: string | null;
  website_url: string | null;
  // #196: sección (club × género × categoría × filial), columnas 032/044.
  gender: string | null;
  age_category: string | null;
  squad_level: number | null;
  team_type: string;
  // Club canónico (Fase 0.3). NULL mientras no se haya corrido el backfill 0.2.
  club_id: string | null;
  club_canonical_name: string | null;
  club_slug: string | null;
  club_crest_url: string | null;
  club_city: string | null;
  club_country: string | null;
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

interface SeasonRow {
  id: string;
  name: string;
  is_current: boolean;
  competition_name: string;
  competition_short_name: string | null;
}

/**
 * Temporada a mostrar en la ficha: la pedida por `?season=` si el equipo
 * participa en ella; si no (o si no se pide), la PRIMERA del listado — que ya
 * viene ordenado con la actual (y la que tiene clasificación) primero. Pura.
 */
export function resolveSelectedSeason(
  requested: string | null,
  seasons: readonly { id: string }[],
): string | null {
  if (requested && seasons.some((s) => s.id === requested)) return requested;
  return seasons[0]?.id ?? null;
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
  competition_timezone: string | null;
  // Ronda y resolución de la eliminatoria (para la síntesis de copas/knockout).
  round_id: string | null;
  round_number: number | null;
  round_name: string | null;
  round_type: string | null;
  winner_team_id: string | null;
  win_type: string | null;
}

/** Competición de la temporada mostrada (para el resumen de eliminatorias). */
interface SeasonInfoRow {
  competition_id: string;
  competition_slug: string;
  competition_name: string;
  competition_short_name: string | null;
  competition_format: string | null;
}

interface SquadRow {
  player_id: string;
  first_name: string;
  last_name: string;
  is_goalkeeper: boolean;
  photo_url: string | null;
  jersey_number: number | null;
  goals: string;
  blue_cards: string;
  red_cards: string;
  penalties: string;
}

/**
 * GET /teams/:id[?season=<uuid>]
 * Devuelve: datos del club, temporadas del equipo (para el selector), y la
 * clasificación, partidos (con ronda y resolución de eliminatoria), plantilla
 * con stats y cuerpo técnico DE LA TEMPORADA elegida (por defecto, la actual),
 * más la competición de esa temporada con su formato (league/bracket/final_four).
 */
teamDetailRouter.get('/:id', async (c) => {
  const id = c.req.param('id');

  // Un id no-UUID haría fallar el cast a uuid de Postgres y devolvería 500
  // (enlace corrupto/bot) en vez de 404 (#275).
  if (!isUuid(id)) return c.json({ error: 'Not found' }, 404);

  // Temporada a mostrar (opcional): la elegida por el selector de la ficha. Un
  // id malformado es un error de petición, no un 404.
  const seasonParam = c.req.query('season');
  if (seasonParam !== undefined && !isUuid(seasonParam)) {
    return c.json({ error: 'season must be a UUID' }, 400);
  }

  try {
    // #333: equipo, temporadas del equipo y secciones del club sólo dependen de
    // `id` → en paralelo. La clasificación depende de la temporada elegida, así
    // que se consulta en el segundo lote.
    const [teamRes, seasonsRes, clubTeamsRes] = await Promise.all([
      // 1) Info del equipo
      db.query<TeamRow>(
        `SELECT t.id, t.name, t.short_name, t.city, t.country, t.logo_url, t.website_url,
                t.gender, t.age_category, t.squad_level, t.team_type,
                t.club_id,
                cl.canonical_name AS club_canonical_name,
                cl.slug           AS club_slug,
                cl.crest_url      AS club_crest_url,
                cl.city           AS club_city,
                cl.country        AS club_country
         FROM teams t
         LEFT JOIN clubs cl ON cl.id = t.club_id
         WHERE t.id = $1`,
        [id]
      ),

      // 2) TODAS las temporadas con datos del equipo (season_teams ∪ clasificación
      // ∪ partidos) para el selector. Orden: actual primero y, dentro de las
      // actuales, la que tiene clasificación (la liga, no la copa) → buen default.
      db.query<SeasonRow>(`
        SELECT se.id, se.name, se.is_current,
               c.name AS competition_name, c.short_name AS competition_short_name
        FROM seasons se
        JOIN competitions c ON c.id = se.competition_id
        JOIN teams t ON t.id = $1
        WHERE se.id IN (
          SELECT season_id FROM season_teams WHERE team_id = $1
          UNION
          SELECT season_id FROM standings   WHERE team_id = $1
          UNION
          SELECT season_id FROM matches     WHERE home_team_id = $1 OR away_team_id = $1
        )
          AND se.data_quality = 'ok'
          AND c.data_quality = 'ok'
          -- Aislamiento de sección: una ficha no lista temporadas de la sección
          -- contraria. Las filas del legado pueden tener gender NULL y pasar;
          -- pero un equipo con género/categoría conocido sólo ve sus ligas.
          -- Sin esto, la ficha femenina de CH MATARÓ abría por defecto en la
          -- clasificación masculina de Plata Sur (datos mal atribuidos).
          AND (t.gender IS NULL OR c.gender IS NULL OR c.gender = t.gender)
          AND (t.age_category IS NULL OR c.age_category IS NULL OR c.age_category = t.age_category)
        ORDER BY se.is_current DESC,
                 EXISTS (SELECT 1 FROM standings st WHERE st.season_id = se.id AND st.team_id = $1) DESC,
                 se.start_date DESC NULLS LAST,
                 se.name DESC
      `, [id]),

      // #197: otras secciones del mismo club (join sobre club_id; el self-join no
      // casa si el club es NULL, así que devuelve vacío hasta el backfill 0.2).
      // El orden definitivo lo fija `orderClubTeams` (función pura testeada).
      db.query<ClubTeamRow>(`
        SELECT t2.id, t2.name, t2.short_name, t2.logo_url,
               t2.gender, t2.age_category, t2.squad_level, t2.team_type
        FROM teams t
        JOIN teams t2 ON t2.club_id = t.club_id AND t2.id <> t.id
        WHERE t.id = $1
        ORDER BY t2.name
      `, [id]),
    ]);

    if (teamRes.rows.length === 0) return c.json({ error: 'Team not found' }, 404);
    const teamRow = teamRes.rows[0]!;
    const clubTeams = orderClubTeams(clubTeamsRes.rows);
    const seasons = seasonsRes.rows;
    const selectedSeasonId = resolveSelectedSeason(seasonParam ?? null, seasons);
    const currentSeasonIds = selectedSeasonId ? [selectedSeasonId] : [];
    let standingRow: StandingRow | null = null;

    // La COMPETICIÓN de la temporada elegida (formato incluido) se consulta
    // antes del bloque grande: si es eliminatoria, hay que pedir además los
    // partidos de TODA la temporada (lite) para que la web pueda derivar las
    // fases del cuadro — con sólo los partidos del equipo, la semifinal de un
    // equipo eliminado no se distingue de una final.
    let seasonInfo: SeasonInfoRow | null = null;
    let structure: SeasonStructure | null = null;
    if (selectedSeasonId) {
      const [seasonInfoRes, phasesRes, roundsRes, structMatchesRes] = await Promise.all([
        db.query<SeasonInfoRow>(`
          SELECT c.id     AS competition_id,
                 c.slug   AS competition_slug,
                 c.name   AS competition_name,
                 c.short_name AS competition_short_name,
                 cs.external_ids->>'format' AS competition_format
          FROM seasons se
          JOIN competitions c ON c.id = se.competition_id
          LEFT JOIN competition_sources cs ON cs.competition_id = c.id
          WHERE se.id = $1
        `, [selectedSeasonId]),
        // Estructura de la temporada (fases → rondas → partidos), la misma que
        // usa /seasons/:id/overview: de ella salen el formato y la fase
        // eliminatoria de cada partido (sin deducirlas por nombre ni fechas).
        db.query<StructurePhaseRow>(`
          SELECT id, ordinal, kind, is_placement, name, resolved_by
          FROM phases WHERE season_id = $1 ORDER BY ordinal, created_at
        `, [selectedSeasonId]),
        db.query<StructureRoundRow>(`
          SELECT id, number, name, round_type, phase_id, stage
          FROM rounds WHERE season_id = $1
        `, [selectedSeasonId]),
        db.query<StructureMatchRow>(`
          SELECT id, round_id, phase_id, series_game, home_team_id, away_team_id, scheduled_at
          FROM matches WHERE season_id = $1
        `, [selectedSeasonId]),
      ]);
      seasonInfo = seasonInfoRes.rows[0] ?? null;
      structure = buildSeasonStructure({
        phases: phasesRes.rows,
        rounds: roundsRes.rows,
        matches: structMatchesRes.rows,
        hasStandings: false,
        declaredFormat: seasonInfo?.competition_format ?? null,
      });
    }
    const competitionFormat = structure?.competitionFormat ?? normalizeCompetitionFormat(seasonInfo?.competition_format);
    const isKnockoutComp = competitionFormat !== 'league';

    // #333: partidos, plantilla, cuerpo técnico y stats sólo dependen del mismo
    // `currentSeasonIds` → un único Promise.all para los cuatro grupos (antes
    // eran cuatro round-trips en serie).
    let matchRows: MatchRow[] = [];
    let squadRows: SquadRow[] = [];
    let staff: Array<{ name: string; role: string }> = [];
    let teamStats: Record<string, unknown> | null = null;
    let koMatchRows: MatchRow[] = [];

    if (currentSeasonIds.length > 0) {
      const [standingRes, matchRes, squadRes, staffRes, koRes, [resultsRes, eventsRes, lineupRes]] = await Promise.all([
        // 2) Clasificación del equipo EN LA TEMPORADA elegida (puede no haber:
        // una eliminatoria no tiene clasificación).
        db.query<StandingRow>(`
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
          WHERE s.team_id = $1 AND s.season_id = $2
          LIMIT 1
        `, [id, selectedSeasonId]),

        // 3) Partidos de la temporada elegida donde participa el equipo. Con
        // ronda (join rounds) y resolución (ganador/prórroga/penaltis) para que
        // la web pueda sintetizar eliminatorias (Supercopa, Copa, playoffs).
        db.query<MatchRow>(`
          SELECT
            m.id, m.status, m.scheduled_at, m.started_at, m.finished_at,
            m.home_score, m.away_score,
            m.venue_name, m.venue_city,
            m.round_id, m.winner_team_id, m.win_type,
            r.number       AS round_number,
            r.name         AS round_name,
            r.round_type,
            ht.id           AS home_team_id,
            ht.name         AS home_team_name,
            ht.short_name   AS home_team_short_name,
            ht.logo_url     AS home_team_logo_url,
            at.id           AS away_team_id,
            at.name         AS away_team_name,
            at.short_name   AS away_team_short_name,
            at.logo_url     AS away_team_logo_url,
            c.timezone      AS competition_timezone
          FROM matches m
          LEFT JOIN rounds r ON r.id = m.round_id
          LEFT JOIN teams ht ON ht.id = m.home_team_id
          LEFT JOIN teams at ON at.id = m.away_team_id
          LEFT JOIN seasons se ON se.id = m.season_id
          LEFT JOIN competitions c ON c.id = se.competition_id
          WHERE m.season_id = ANY($1)
            AND (m.home_team_id = $2 OR m.away_team_id = $2)
          ORDER BY m.scheduled_at ASC NULLS LAST
        `, [currentSeasonIds, id]),

        // 4) Plantilla con stats agregadas de match_events (temporada elegida)
        db.query<SquadRow>(`
          SELECT
            p.id            AS player_id,
            p.first_name,
            p.last_name,
            -- Portero: si el jugador aparece marcado como tal en CUALQUIER
            -- alineación de la temporada (match_lineups.is_goalkeeper). La fuente
            -- no da una posición de jugador; sólo marca al portero por partido.
            EXISTS (
              SELECT 1 FROM match_lineups ml
              JOIN matches mx ON mx.id = ml.match_id
              WHERE ml.player_id = p.id
                AND ml.is_goalkeeper = TRUE
                AND mx.season_id = ANY($1)
            )               AS is_goalkeeper,
            p.photo_url,
            tp.jersey_number,
            COUNT(DISTINCT me_g.id)  FILTER (WHERE me_g.event_type = 'goal')       AS goals,
            COUNT(DISTINCT me_b.id)  FILTER (WHERE me_b.event_type = 'blue_card')  AS blue_cards,
            COUNT(DISTINCT me_r.id)  FILTER (WHERE me_r.event_type = 'red_card')   AS red_cards,
            COUNT(DISTINCT me_p.id)  FILTER (WHERE me_p.event_type = 'penalty')    AS penalties
          FROM team_players tp
          JOIN players p ON p.id = tp.player_id
          -- Agregados desde match_events (LEFT JOIN para no excluir jugadores sin eventos).
          -- #214: acotar por team_id del propio tp — un jugador traspasado tiene
          -- eventos marcados con su equipo anterior; sin este filtro la plantilla
          -- atribuía al equipo actual goles/tarjetas marcados con OTRO equipo.
          LEFT JOIN match_events me_g ON me_g.player_id = p.id
            AND me_g.event_type = 'goal'
            AND me_g.team_id = tp.team_id
            AND EXISTS (SELECT 1 FROM matches mx WHERE mx.id = me_g.match_id AND mx.season_id = ANY($1))
          LEFT JOIN match_events me_b ON me_b.player_id = p.id
            AND me_b.event_type = 'blue_card'
            AND me_b.team_id = tp.team_id
            AND EXISTS (SELECT 1 FROM matches mx WHERE mx.id = me_b.match_id AND mx.season_id = ANY($1))
          LEFT JOIN match_events me_r ON me_r.player_id = p.id
            AND me_r.event_type = 'red_card'
            AND me_r.team_id = tp.team_id
            AND EXISTS (SELECT 1 FROM matches mx WHERE mx.id = me_r.match_id AND mx.season_id = ANY($1))
          LEFT JOIN match_events me_p ON me_p.player_id = p.id
            AND me_p.event_type = 'penalty'
            AND me_p.team_id = tp.team_id
            AND EXISTS (SELECT 1 FROM matches mx WHERE mx.id = me_p.match_id AND mx.season_id = ANY($1))
          WHERE tp.team_id = $2
            AND tp.season_id = ANY($1)
            AND tp.is_active = TRUE
          GROUP BY p.id, p.first_name, p.last_name, p.photo_url, tp.jersey_number
          ORDER BY
            is_goalkeeper DESC,          -- porteros primero (ahora sí: dato real)
            tp.jersey_number NULLS LAST,
            p.last_name
        `, [currentSeasonIds, id]),

        // 4b) Cuerpo técnico — del partido más reciente con acta procesada
        db.query<{ player_name: string; role: string }>(`
          SELECT DISTINCT ON (ml.player_name) ml.player_name, ml.role
          FROM match_lineups ml
          JOIN matches m ON m.id = ml.match_id
          WHERE m.season_id = ANY($1)
            AND ((ml.is_home AND m.home_team_id = $2) OR (NOT ml.is_home AND m.away_team_id = $2))
            AND ml.role IS NOT NULL
          ORDER BY ml.player_name, m.scheduled_at DESC
        `, [currentSeasonIds, id]),

        // 4c) Partidos de TODA la temporada (lite), sólo en competiciones
        // eliminatorias: son el cuadro con el que la web deriva las fases
        // (con sólo los partidos del equipo, una semifinal perdida sería
        // indistinguible de una final). Payload pequeño (≤ ~10 filas).
        isKnockoutComp
          ? db.query<MatchRow>(`
              SELECT
                m.id, m.status, m.scheduled_at, m.started_at, m.finished_at,
                m.home_score, m.away_score,
                NULL::text AS venue_name, NULL::text AS venue_city,
                m.round_id, m.winner_team_id, m.win_type,
                r.number       AS round_number,
                r.name         AS round_name,
                r.round_type,
                ht.id           AS home_team_id,
                ht.name         AS home_team_name,
                ht.short_name   AS home_team_short_name,
                ht.logo_url     AS home_team_logo_url,
                at.id           AS away_team_id,
                at.name         AS away_team_name,
                at.short_name   AS away_team_short_name,
                at.logo_url     AS away_team_logo_url,
                c.timezone      AS competition_timezone
              FROM matches m
              LEFT JOIN rounds r ON r.id = m.round_id
              LEFT JOIN teams ht ON ht.id = m.home_team_id
              LEFT JOIN teams at ON at.id = m.away_team_id
              LEFT JOIN seasons se ON se.id = m.season_id
              LEFT JOIN competitions c ON c.id = se.competition_id
              WHERE m.season_id = ANY($1)
              ORDER BY m.scheduled_at ASC NULLS LAST
            `, [currentSeasonIds])
          : Promise.resolve({ rows: [] as MatchRow[] }),

        // 5) Estadísticas propias del equipo (temporada elegida)
        Promise.all([
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
                WHERE e.event_type = 'penalty' AND ${penaltyScoredSql('e')}
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
        ]),
      ]);

      standingRow = standingRes.rows[0] ?? null;
      matchRows = matchRes.rows;
      squadRows = squadRes.rows;
      koMatchRows = koRes.rows;

      const ROLE_ORDER: Record<string, number> = { E1: 0, E: 0, E2: 1, A: 2, D: 3 };
      staff = staffRes.rows
        .map((r) => ({ name: r.player_name, role: r.role }))
        .sort((a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9));

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

    // Club canónico (Fase 0.3): identidad estable por encima de la sección.
    // NULL hasta que el backfill 0.2 rellene teams.club_id; el consumidor debe
    // degradar al propio team (name/logo) en ese caso.
    const club = teamRow.club_id ? {
      id:            teamRow.club_id,
      canonicalName: teamRow.club_canonical_name,
      slug:          teamRow.club_slug,
      crestUrl:      teamRow.club_crest_url,
      city:          teamRow.club_city,
      country:       teamRow.club_country,
    } : null;

    const team = {
      id:         teamRow.id,
      name:       teamRow.name,
      shortName:  teamRow.short_name,
      city:       teamRow.city,
      country:    teamRow.country,
      logoUrl:    teamRow.logo_url,
      websiteUrl: teamRow.website_url,
      // #196: identidad de sección (género/categoría/filial) para desambiguar
      // fichas del mismo club. `sectionSuffix` es la forma compacta para listas.
      gender:        teamRow.gender,
      ageCategory:   teamRow.age_category,
      squadLevel:    teamRow.squad_level,
      teamType:      teamRow.team_type,
      sectionSuffix: sectionSuffix(teamRow),
      club,
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

    // Formato declarado de la competición de la temporada mostrada. En una
    // eliminatoria los partidos pueden venir sin ronda asignada (fuente que no
    // las publica): se marcan como 'playoff' igual que hace season-overview.
    const serializeMatch = (m: MatchRow) => {
      const st = structure?.byMatch.get(m.id);
      return {
        id:          m.id,
        status:      m.status,
        competitionTimezone: m.competition_timezone,
        scheduledAt: m.scheduled_at,
        startedAt:   m.started_at,
        finishedAt:  m.finished_at,
        score:       { home: m.home_score, away: m.away_score },
        venue:       m.venue_name ? { name: m.venue_name, city: m.venue_city } : null,
        roundId:     m.round_id,
        // Legado (1=QF/2=SF/3=F/0=colocación en eliminatorias) desde la fase
        // explícita; la web nueva lee `stage`.
        roundNumber: st ? st.roundNumber : m.round_number,
        roundName:   m.round_name,
        roundType:   st?.roundType ?? m.round_type ?? (isKnockoutComp ? 'playoff' : null),
        phaseId:     st?.phaseId ?? null,
        stage:       st?.stage ?? null,
        seriesGame:  st?.seriesGame ?? null,
        winnerTeamId: m.winner_team_id,
        winType:     m.win_type,
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
    };

    const matches = matchRows.map(serializeMatch);

    const squad = squadRows.map((p) => ({
      playerId:     p.player_id,
      firstName:    p.first_name,
      lastName:     p.last_name,
      photoUrl:     p.photo_url,
      isGoalkeeper: p.is_goalkeeper,
      jerseyNumber: p.jersey_number,
      goals:        Number(p.goals),
      blueCards:    Number(p.blue_cards),
      redCards:     Number(p.red_cards),
      penalties:    Number(p.penalties),
    }));

    // #197: otras secciones del club (club × género × categoría × filial) para
    // poder navegar de una ficha a las demás. Vacío con el backfill 1:1 actual.
    const clubTeamsPayload = clubTeams.map((r) => ({
      id:            r.id,
      name:          r.name,
      shortName:     r.short_name,
      logoUrl:       r.logo_url,
      gender:        r.gender,
      ageCategory:   r.age_category,
      squadLevel:    r.squad_level,
      teamType:      r.team_type,
      sectionSuffix: sectionSuffix(r),
    }));

    const seasonsPayload = seasons.map((s) => ({
      id: s.id,
      name: s.name,
      isCurrent: s.is_current,
      competitionName: s.competition_name,
      competitionShort: s.competition_short_name,
    }));

    return c.json({
      team,
      clubTeams: clubTeamsPayload,
      seasons: seasonsPayload,
      selectedSeasonId,
      // Competición de la temporada mostrada: la web la usa para el resumen de
      // eliminatorias (formato) y para etiquetar la ronda de cada partido.
      season: seasonInfo ? {
        competitionId:    seasonInfo.competition_id,
        competitionSlug:  seasonInfo.competition_slug,
        competitionName:  seasonInfo.competition_name,
        competitionShort: seasonInfo.competition_short_name,
        competitionFormat,
        phases:           structure?.phases ?? [],
      } : null,
      // Cuadro completo de la temporada (lite) en competiciones eliminatorias:
      // sin él, la fase de una eliminatoria del equipo no es derivable.
      knockoutMatches: isKnockoutComp ? koMatchRows.map(serializeMatch) : undefined,
      standing,
      matches,
      squad,
      staff,
      stats: teamStats,
    });
  } catch (err) {
    captureRouteError(err, 'team-detail] GET /:id error');
    logger.error({ err }, '[team-detail] GET /:id error');
    return c.json({ error: 'Database error' }, 500);
  }
});

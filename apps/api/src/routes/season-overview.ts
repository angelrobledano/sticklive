import { Hono } from 'hono';
import { db } from '@sports/db';
import { logger } from '@sports/logger';
import { isUuid } from '../lib/uuid.js';
import { captureRouteError } from '../lib/route-error.js';
import { normalizeCompetitionFormat } from '../lib/competition-format.js';

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
  venue_name: string | null;
  round_id: string | null;
  round_number: number | null;
  round_name: string | null;
  round_type: string | null;
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
    const [seasonRes, standingsRes, roundsRes, matchesRes] = await Promise.all([
      // 1) Season + competition info
      db.query<SeasonRow>(`
        SELECT s.id, s.name, s.slug AS season_slug, s.start_date, s.end_date,
               c.id         AS competition_id,
               c.name       AS competition_name,
               c.slug       AS competition_slug,
               c.name_i18n  AS competition_name_i18n,
               c.short_name AS competition_short_name,
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
          t.name         AS team_name,
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

      // 3) Rounds (para selector de jornadas)
      db.query<RoundRow>(`
        SELECT id, number, name, round_type
        FROM rounds
        WHERE season_id = $1
        ORDER BY
          CASE round_type WHEN 'regular' THEN 0 WHEN 'playoff' THEN 1 ELSE 2 END,
          number ASC
      `, [seasonId]),

      // 4) Todos los partidos con equipos
      db.query<MatchRow>(`
        SELECT
          m.id, m.status, m.scheduled_at, m.started_at, m.finished_at,
          m.home_score, m.away_score, m.winner_team_id, m.win_type, m.venue_name, m.round_id,
          r.number       AS round_number,
          r.name         AS round_name,
          r.round_type,
          ht.id          AS home_team_id,
          ht.name        AS home_team_name,
          ht.short_name  AS home_team_short_name,
          ht.logo_url    AS home_team_logo_url,
          at.id          AS away_team_id,
          at.name        AS away_team_name,
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
    ]);

    if (seasonRes.rows.length === 0) return c.json({ error: 'Season not found' }, 404);
    const s = seasonRes.rows[0]!;

    // ── Fases derivadas de la fase de playoff ──────────────────────
    // Modelo de fases: los partidos de playoff viven en la misma temporada
    // que la liga, marcados con rounds.round_type='playoff' (la ronda de
    // fase no distingue QF/SF/F). Derivamos la fase agrupando por
    // eliminatoria (pareja de equipos) y ordenando las series por fecha:
    // la última es la Final, las dos anteriores Semis, el resto Cuartos.
    // roundNumber derivado: 1=QF, 2=SF, 3=F, 0=permanencia.
    // (Legacy: competiciones-playoff puras sin rounds se siguen soportando.)
    const isLegacyPlayoffComp = /play[- ]?off/i.test(s.competition_name);
    const playoffRows = matchesRes.rows.filter(
      (m) => m.round_type === 'playoff' || (isLegacyPlayoffComp && !m.round_id)
    );

    // Si la fuente ya distingue las fases eliminatorias con rondas propias
    // (varias rounds de playoff distintas: Cuartos/Semis/Final/3º-4º — caso
    // World Skate), respetamos su número/nombre real y NO derivamos. La
    // derivación por cronología es solo para el playoff de OK Liga, que vive
    // en una única ronda 'playoff' sin distinción de fase.
    const distinctPlayoffRounds = new Set(
      playoffRows.map((m) => m.round_id).filter((x): x is string => !!x)
    );
    // Final Four: sus rondas son la verdad aunque por ahora solo exista la de
    // semifinales (la final no se publica hasta conocerse los finalistas). No
    // derivar por cronología. Ver `format` en competition_sources.
    const hasRealPhases = distinctPlayoffRounds.size > 1 || s.competition_format === 'final_four';

    // Una competición `bracket`/`final_four` es de eliminatorias: sus partidos
    // son de playoff aunque el scrape no les haya asignado una ronda (p. ej. una
    // eliminatoria cuyos partidos vienen de otra fuente que su calendario).
    const isKnockoutComp = s.competition_format === 'bracket' || s.competition_format === 'final_four';

    const derivedRound = new Map<string, number>(); // matchId → roundNumber
    if (playoffRows.length > 0 && !hasRealPhases) {
      const seriesMap = new Map<string, { firstDate: number; matchIds: string[] }>();
      for (const m of playoffRows) {
        const key = [m.home_team_id, m.away_team_id].sort().join('|');
        const date = m.scheduled_at ? new Date(m.scheduled_at).getTime() : Number.MAX_SAFE_INTEGER;
        const entry = seriesMap.get(key) ?? { firstDate: date, matchIds: [] };
        entry.firstDate = Math.min(entry.firstDate, date);
        entry.matchIds.push(m.id);
        seriesMap.set(key, entry);
      }
      const series = [...seriesMap.values()].sort((a, b) => a.firstDate - b.firstDate);
      const n = series.length;
      series.forEach((serie, idx) => {
        // Última serie = Final (3), dos anteriores = Semis (2), resto = Cuartos (1)
        const roundNumber = idx === n - 1 ? 3 : idx >= n - 3 ? 2 : 1;
        for (const id of serie.matchIds) derivedRound.set(id, roundNumber);
      });

      // Serie de COLOCACIÓN 9º–10º (no es permanencia): el idc del playoff
      // incluye también la eliminatoria entre el 9º y el 10º de la fase
      // regular (p.ej. Alcoi-Rivas), que fija el orden final y decide la
      // última plaza europea (WSE Cup). Detección: en un cuadro real cada
      // serie de cuartos aporta un equipo a semis; la serie cuyos equipos no
      // aparecen en fases posteriores es la de colocación → roundNumber 0
      // (la web la muestra como fase propia "9º–10º", fuera del cuadro).
      if (n > 4) {
        const matchTeams = new Map(matchesRes.rows.map((m) => [m.id, [m.home_team_id, m.away_team_id]]));
        const laterTeams = new Set<string>();
        for (const [matchId, rn] of derivedRound) {
          if (rn >= 2) for (const t of matchTeams.get(matchId) ?? []) laterTeams.add(t);
        }
        if (laterTeams.size > 0) {
          for (const serie of series.slice(0, n - 3)) {
            const teams = serie.matchIds.flatMap((id) => matchTeams.get(id) ?? []);
            if (!teams.some((t) => laterTeams.has(t))) {
              for (const id of serie.matchIds) derivedRound.set(id, 0);
            }
          }
        }
      }
    }

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
        competitionOrganizer: s.competition_organizer,
        competitionScope:     s.competition_scope,
        competitionCountry:   s.competition_country,
        competitionRegion:    s.competition_region,
        competitionTimezone:  s.competition_timezone,
        // Formato de competición (competition_sources): solo se reconocen los
        // valores conocidos; cualquier otro cae a 'league'.
        competitionFormat: normalizeCompetitionFormat(s.competition_format),
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
      rounds: roundsRes.rows.map((r) => ({
        id:        r.id,
        number:    r.number,
        name:      r.name,
        roundType: r.round_type,
      })),
      matches: matchesRes.rows.map((m) => ({
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
        venueName:   m.venue_name,
        roundId:     m.round_id,
        // Playoff OK Liga: manda la fase derivada (1=QF/2=SF/3=F/0=playout).
        // Playoff con fases reales (World Skate): número real de la ronda.
        // Liga: número de jornada.
        roundNumber: derivedRound.get(m.id) ?? m.round_number,
        roundName:   m.round_name,
        roundType:   m.round_type ?? (derivedRound.has(m.id) || isKnockoutComp ? 'playoff' : 'regular'),
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
      })),
    }, 200);
  } catch (err) {
    captureRouteError(err, 'season-overview] GET /:id/overview error');
    logger.error({ err }, '[season-overview] GET /:id/overview error');
    return c.json({ error: 'Database error' }, 500);
  }
});

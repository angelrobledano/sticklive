import { Hono } from 'hono';
import { db } from '@sports/db';
import { isUuid } from '../lib/uuid.js';
import { buildPlayerCareer, type CareerRow } from '../lib/player-career.js';
import { captureRouteError } from '../lib/route-error.js';
import { penaltyScoredSql } from '../lib/penalty-sql.js';

export const playerDetailRouter = new Hono();

interface PlayerRow {
  id: string;
  first_name: string;
  last_name: string;
  birth_date: Date | null;
  nationality: string | null;
  is_goalkeeper: boolean;
  source_ref: string | null;
  photo_url: string | null;
}

interface TeamRow {
  team_id: string;
  team_name: string;
  team_short_name: string | null;
  team_logo_url: string | null;
  jersey_number: number | null;
  season_id: string;
}

interface CompStatsRow {
  competition_id: string;
  competition_name: string;
  competition_short: string | null;
  pj: string;           // COUNT DISTINCT — devuelve bigint como string en pg
  goals: string;
  assists: string;
  blue_cards: string;
  red_cards: string;
  penalties_total: string;
  penalties_scored: string;
}

/**
 * GET /players/:id
 * Devuelve ficha del jugador, equipo actual y estadísticas de la temporada
 * activa desglosadas por competición.
 */
playerDetailRouter.get('/:id', async (c) => {
  const id = c.req.param('id');

  // Un id no-UUID haría fallar el cast a uuid de Postgres y devolvería 500
  // (enlace corrupto/bot) en vez de 404 (#275).
  if (!isUuid(id)) return c.json({ error: 'Not found' }, 404);

  try {
    // 1) Datos del jugador
    const playerRes = await db.query<PlayerRow>(
      `SELECT id, first_name, last_name, birth_date, nationality, source_ref, photo_url,
              -- Portero si aparece marcado como tal en la ÚLTIMA temporada con
              -- alineaciones (#218): antes el badge era de por vida — un ex-
              -- portero lo conservaba para siempre. La fuente no da posición,
              -- sólo el portero por partido.
              EXISTS (
                SELECT 1 FROM match_lineups ml
                JOIN matches mx ON mx.id = ml.match_id
                WHERE ml.player_id = players.id AND ml.is_goalkeeper = TRUE
                  AND mx.season_id = (
                    SELECT mx2.season_id FROM match_lineups ml2
                      JOIN matches mx2 ON mx2.id = ml2.match_id
                      JOIN seasons s2  ON s2.id  = mx2.season_id
                      JOIN competitions c2 ON c2.id = s2.competition_id
                     WHERE ml2.player_id = players.id
                       AND s2.data_quality = 'ok'
                       AND c2.data_quality = 'ok'
                     ORDER BY s2.start_date DESC
                     LIMIT 1
                  )
              ) AS is_goalkeeper
       FROM players WHERE id = $1`,
      [id]
    );
    if (playerRes.rows.length === 0) return c.json({ error: 'Player not found' }, 404);
    const p = playerRes.rows[0]!;

    // 2-4) Equipo actual, stats de la temporada activa y carrera (#217). Las
    // tres consultas sólo dependen del id → en paralelo.
    const [teamRes, statsRes, careerRes] = await Promise.all([
      // 2) Equipo actual (#213): la última TEMPORADA con registro del jugador,
      // no el flag global `is_current` — ese flag estaba disperso (copas 2025/26
      // marcadas actuales tapaban la liga en curso) y cambiaba qué ficha se
      // mostraba. El registro más reciente por start_date es la pertenencia
      // vigente de verdad.
      db.query<TeamRow>(`
      SELECT
        t.id          AS team_id,
        t.name        AS team_name,
        t.short_name  AS team_short_name,
        t.logo_url    AS team_logo_url,
        tp.jersey_number,
        tp.season_id
      FROM team_players tp
      JOIN teams t   ON t.id  = tp.team_id
      JOIN seasons s ON s.id  = tp.season_id
      JOIN competitions c ON c.id = s.competition_id
      WHERE tp.player_id = $1
        AND tp.is_active  = TRUE
        AND s.data_quality = 'ok'
        AND c.data_quality = 'ok'
      ORDER BY s.start_date DESC NULLS LAST
      LIMIT 1
    `, [id]),

      // 3) Stats por competición (#213 + #218): por competición, la ÚLTIMA
      //     temporada con ACTIVIDAD del jugador (alineaciones ∪ eventos — antes
      //     sólo eventos). PJ REAL = partidos con alineación del jugador, con
      //     fallback a eventos donde no haya alineación (histórico sin actas);
      //     el proxy COUNT(DISTINCT match_id) de eventos subestimaba (GAL·LA
      //     SOLÉ: ~8 PJ por eventos vs 19 actas). Asistencias desde
      //     match_lineups.assists (migración 009), que la ficha mostraba como
      //     "—". La heurística de penalti marcado es la COMPARTIDA (#218).
      //
      //     Las filas se emiten por COMPETICIÓN CON ACTIVIDAD (alineación o
      //     evento), no por evento: antes, un jugador que JUGÓ pero no marcó ni
      //     vio tarjeta no tenía ninguna fila → `seasonTotals.pj = 0` → la web
      //     pintaba "Sin estadísticas en la temporada actual" y su ficha era una
      //     página fina (345 de los 1.667 jugadores del sitemap, ~21%: medido en
      //     producción el 16-oct-2026).
      db.query<CompStatsRow>(`
      WITH actividad AS (
        SELECT c.id AS competition_id, MAX(s.start_date) AS inicio
          FROM (
            SELECT m.season_id FROM match_lineups ml JOIN matches m ON m.id = ml.match_id WHERE ml.player_id = $1
            UNION
            SELECT m.season_id FROM match_events me JOIN matches m ON m.id = me.match_id WHERE me.player_id = $1
          ) act
          JOIN seasons s      ON s.id  = act.season_id
          JOIN competitions c ON c.id  = s.competition_id
         WHERE s.data_quality = 'ok' AND c.data_quality = 'ok'
         GROUP BY c.id
      ),
      pj_real AS (
        SELECT c.id AS competition_id, COUNT(DISTINCT x.match_id)::text AS pj,
               COALESCE(SUM(ml.assists), 0)::text AS assists
          FROM (
            SELECT DISTINCT m.id AS match_id, s.competition_id
              FROM match_lineups ml
              JOIN matches m      ON m.id  = ml.match_id
              JOIN seasons s      ON s.id  = m.season_id
              JOIN actividad a    ON a.competition_id = s.competition_id AND s.start_date = a.inicio
             WHERE ml.player_id = $1
               AND s.data_quality = 'ok'
            UNION
            SELECT DISTINCT m.id, s.competition_id
              FROM match_events me
              JOIN matches m      ON m.id  = me.match_id
              JOIN seasons s      ON s.id  = m.season_id
              JOIN actividad a    ON a.competition_id = s.competition_id AND s.start_date = a.inicio
             WHERE me.player_id = $1
               AND s.data_quality = 'ok'
          ) x
          JOIN competitions c ON c.id = x.competition_id
          LEFT JOIN match_lineups ml ON ml.match_id = x.match_id AND ml.player_id = $1
         GROUP BY c.id
      ),
      eventos AS (
        SELECT c.id AS competition_id,
               COUNT(*) FILTER (WHERE me.event_type = 'goal')       AS goals,
               COUNT(*) FILTER (WHERE me.event_type = 'blue_card')  AS blue_cards,
               COUNT(*) FILTER (WHERE me.event_type = 'red_card')   AS red_cards,
               COUNT(*) FILTER (WHERE me.event_type = 'penalty')    AS penalties_total,
               COUNT(*) FILTER (
                 WHERE me.event_type = 'penalty'
                   AND ${penaltyScoredSql('me')}
               )                                                    AS penalties_scored
          FROM match_events me
          JOIN matches m      ON m.id  = me.match_id
          JOIN seasons s      ON s.id  = m.season_id
          JOIN competitions c ON c.id  = s.competition_id
          JOIN actividad a    ON a.competition_id = c.id AND s.start_date = a.inicio
         WHERE me.player_id = $1
           AND s.data_quality = 'ok'
           AND c.data_quality = 'ok'
         GROUP BY c.id
      )
      SELECT
        c.id                AS competition_id,
        c.name              AS competition_name,
        c.short_name        AS competition_short,
        COALESCE(p.pj, '0')                AS pj,
        COALESCE(p.assists, '0')           AS assists,
        COALESCE(e.goals, 0)               AS goals,
        COALESCE(e.blue_cards, 0)          AS blue_cards,
        COALESCE(e.red_cards, 0)           AS red_cards,
        COALESCE(e.penalties_total, 0)     AS penalties_total,
        COALESCE(e.penalties_scored, 0)    AS penalties_scored
      FROM competitions c
      LEFT JOIN pj_real p ON p.competition_id = c.id
      LEFT JOIN eventos e ON e.competition_id = c.id
     WHERE p.competition_id IS NOT NULL OR e.competition_id IS NOT NULL
     ORDER BY goals DESC, pj DESC
    `, [id]),

      // 4) Carrera (#217): equipos por temporada desde DOS fuentes. La
      // pertenencia (`team_players`) cubre 2025/26+; los eventos con `team_id`
      // cubren el histórico sin plantilla. El NOT EXISTS evita contar dos veces
      // un par (temporada, equipo) ya presente en `team_players`.
      db.query<CareerRow>(`
      SELECT
        s.id            AS season_id,
        s.name          AS season_name,
        s.start_date    AS season_start,
        s.is_current    AS is_current,
        c.id            AS competition_id,
        c.name          AS competition_name,
        c.short_name    AS competition_short,
        t.id            AS team_id,
        t.name          AS team_name,
        t.short_name    AS team_short_name,
        t.logo_url      AS team_logo_url,
        tp.jersey_number,
        agg.pj, agg.goals, agg.blue_cards, agg.red_cards,
        agg.penalties_total, agg.penalties_scored
      FROM team_players tp
      JOIN seasons s      ON s.id = tp.season_id
      JOIN competitions c ON c.id = s.competition_id
      JOIN teams t        ON t.id = tp.team_id
      LEFT JOIN LATERAL (
        SELECT
          COUNT(DISTINCT me.match_id)                          AS pj,
          COUNT(*) FILTER (WHERE me.event_type = 'goal')       AS goals,
          COUNT(*) FILTER (WHERE me.event_type = 'blue_card')  AS blue_cards,
          COUNT(*) FILTER (WHERE me.event_type = 'red_card')   AS red_cards,
          COUNT(*) FILTER (WHERE me.event_type = 'penalty')    AS penalties_total,
          COUNT(*) FILTER (
            WHERE me.event_type = 'penalty'
              AND (
                me.detail ILIKE '%gol%'
                OR me.detail ILIKE '%marcado%'
                OR me.detail ILIKE '%anotado%'
                OR me.detail ILIKE '%dentro%'
              )
          )                                                     AS penalties_scored
        FROM match_events me
        JOIN matches m ON m.id = me.match_id
        WHERE me.player_id = tp.player_id
          AND me.team_id    = tp.team_id
          AND m.season_id   = tp.season_id
      ) agg ON TRUE
      WHERE tp.player_id = $1
        AND s.data_quality = 'ok'
        AND c.data_quality = 'ok'

      UNION ALL

      SELECT
        s.id, s.name, s.start_date, s.is_current,
        c.id, c.name, c.short_name,
        t.id, t.name, t.short_name, t.logo_url,
        NULL::int AS jersey_number,
        COUNT(DISTINCT me.match_id),
        COUNT(*) FILTER (WHERE me.event_type = 'goal'),
        COUNT(*) FILTER (WHERE me.event_type = 'blue_card'),
        COUNT(*) FILTER (WHERE me.event_type = 'red_card'),
        COUNT(*) FILTER (WHERE me.event_type = 'penalty'),
        COUNT(*) FILTER (
          WHERE me.event_type = 'penalty'
            AND ${penaltyScoredSql('me')}
        )
      FROM match_events me
      JOIN matches m      ON m.id = me.match_id
      JOIN seasons s      ON s.id = m.season_id
      JOIN competitions c ON c.id = s.competition_id
      JOIN teams t        ON t.id = me.team_id
      WHERE me.player_id = $1
        AND s.data_quality = 'ok'
        AND c.data_quality = 'ok'
        AND me.team_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM team_players tp
          WHERE tp.player_id = me.player_id
            AND tp.season_id = m.season_id
            AND tp.team_id   = me.team_id
        )
      GROUP BY s.id, s.name, s.start_date, s.is_current,
               c.id, c.name, c.short_name,
               t.id, t.name, t.short_name, t.logo_url

      ORDER BY season_start DESC NULLS LAST, season_name DESC,
               team_name ASC, competition_name ASC
    `, [id]),
    ]);

    const teamRow = teamRes.rows[0] ?? null;

    // Totales globales de la temporada (suma de todas las competiciones)
    const totals = statsRes.rows.reduce(
      (acc, r) => ({
        pj:              acc.pj              + Number(r.pj),
        goals:           acc.goals           + Number(r.goals),
        assists:         acc.assists         + Number(r.assists),
        blueCards:       acc.blueCards       + Number(r.blue_cards),
        redCards:        acc.redCards        + Number(r.red_cards),
        penaltiesTotal:  acc.penaltiesTotal  + Number(r.penalties_total),
        penaltiesScored: acc.penaltiesScored + Number(r.penalties_scored),
      }),
      { pj: 0, goals: 0, assists: 0, blueCards: 0, redCards: 0, penaltiesTotal: 0, penaltiesScored: 0 }
    );

    return c.json({
      player: {
        id:          p.id,
        firstName:   p.first_name,
        lastName:    p.last_name,
        birthDate:   p.birth_date,
        nationality: p.nationality,
        isGoalkeeper: p.is_goalkeeper,
        sourceRef:   p.source_ref,
        photoUrl:    p.photo_url,
      },
      currentTeam: teamRow ? {
        id:           teamRow.team_id,
        name:         teamRow.team_name,
        shortName:    teamRow.team_short_name,
        logoUrl:      teamRow.team_logo_url,
        jerseyNumber: teamRow.jersey_number,
        seasonId:     teamRow.season_id,
      } : null,
      seasonTotals: totals,
      // #217: trayectoria completa (temporadas agrupadas + totales de carrera).
      career: buildPlayerCareer(careerRes.rows),
      statsByCompetition: statsRes.rows.map((r) => ({
        competitionId:    r.competition_id,
        competitionName:  r.competition_name,
        competitionShort: r.competition_short,
        pj:               Number(r.pj),
        goals:            Number(r.goals),
        assists:          Number(r.assists),
        blueCards:        Number(r.blue_cards),
        redCards:         Number(r.red_cards),
        penaltiesTotal:   Number(r.penalties_total),
        penaltiesScored:  Number(r.penalties_scored),
      })),
    });
  } catch (err) {
    captureRouteError(err, 'GET /players/:id');
    return c.json({ error: 'Database error' }, 500);
  }
});

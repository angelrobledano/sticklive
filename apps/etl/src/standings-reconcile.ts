/**
 * Reconciliación de CLASIFICACIONES con los partidos de su MISMA temporada (#226).
 *
 * Las standings se guardan tal cual de la fuente (`standing.loader.ts`,
 * `points: raw.points`). Tras el enrich de temporadas/marcadores, recalcular
 * PJ/V/E/D/GF/GC desde los partidos `finished` es la prueba de que la
 * clasificación y el calendario hablan de la misma temporada. La auditoría de
 * integridad (2026-09-27) encontró que solo reconciliaban 323/2.414 filas.
 *
 * Se compara SIN `points` ni `penalization_points`: las deducciones de la 010
 * no alteran V/E/D/GF/GC, así que meterlas daría falsos positivos. La regla de
 * puntos (3-1-0 vs 2-1-0) es aparte y se documenta por competición, no se inventa.
 *
 * `$1` = `import_batch_id` (uuid) para acotar a las temporadas de un lote, o
 * `NULL` para auditar todo.
 */
import { db } from '@sports/db';

export const STANDINGS_RECONCILE_SQL = `
WITH recalc AS (
  SELECT season_id, team_id,
         count(*)::int                              AS played,
         count(*) FILTER (WHERE gf > ga)::int        AS won,
         count(*) FILTER (WHERE gf = ga)::int        AS drawn,
         count(*) FILTER (WHERE gf < ga)::int        AS lost,
         coalesce(sum(gf), 0)::int                    AS gf,
         coalesce(sum(ga), 0)::int                    AS ga
    FROM (
      SELECT season_id, home_team_id AS team_id, home_score AS gf, away_score AS ga
        FROM matches
       WHERE status = 'finished' AND home_score IS NOT NULL AND away_score IS NOT NULL
      UNION ALL
      SELECT season_id, away_team_id, away_score, home_score
        FROM matches
       WHERE status = 'finished' AND home_score IS NOT NULL AND away_score IS NOT NULL
    ) t
   GROUP BY season_id, team_id
)
SELECT count(*)::text AS n
  FROM standings st
  JOIN recalc r ON r.season_id = st.season_id AND r.team_id = st.team_id
 WHERE (st.played <> r.played OR st.won <> r.won OR st.drawn <> r.drawn
        OR st.lost <> r.lost OR st.goals_for <> r.gf OR st.goals_against <> r.ga)
   AND ($1::uuid IS NULL
        OR st.season_id IN (SELECT DISTINCT season_id FROM matches WHERE import_batch_id = $1))
`;

/**
 * Nº de filas de clasificación que NO reconcilian con los partidos de su
 * temporada. 0 = todo cuadra. `batchId` acota a las temporadas de un lote.
 */
export async function countStandingsMismatches(batchId: string | null = null): Promise<number> {
  const { rows } = await db.query<{ n: string }>(STANDINGS_RECONCILE_SQL, [batchId]);
  return Number(rows[0]?.n ?? 0);
}

// ── C7: clasificación final de temporadas cerradas (ver standings-final.ts) ──

/** Tope por ejecución: si la fuente no da la tabla, se reintenta al día siguiente. */
const MAX_SEASONS_PER_RUN = 25;

export interface StaleFinalStandings {
  seasonId: string;
  idc: string;
  competitionName: string;
  seasonName: string;
  /** Equipos con menos PJ en la tabla que partidos de liga terminados. */
  staleTeams: number;
}

/**
 * Temporadas cerradas (sin partidos por jugar ni en juego) con la tabla
 * atrasada. Cuentan los partidos sin fase o de fase de liga/grupos: los de una
 * eliminatoria no suman a la clasificación.
 */
export async function findStaleFinalStandings(limit = MAX_SEASONS_PER_RUN): Promise<StaleFinalStandings[]> {
  const { rows } = await db.query<{
    season_id: string; idc: string; competition_name: string; season_name: string; stale_teams: number;
  }>(
    `WITH closed AS (
       SELECT s.id, s.source_ref AS idc, s.name AS season_name, c.name AS competition_name
         FROM seasons s
         JOIN competitions c ON c.id = s.competition_id
        WHERE s.source_ref ~ '^[0-9]+$'
          AND EXISTS (SELECT 1 FROM matches m WHERE m.season_id = s.id AND m.status = 'finished')
          AND NOT EXISTS (
            SELECT 1 FROM matches m
             WHERE m.season_id = s.id
               AND m.status IN ('scheduled', 'live', 'halftime', 'overtime', 'penalty_shootout'))
     ),
     league_played AS (
       SELECT x.season_id, x.team_id, count(*)::int AS pj
         FROM (
           SELECT m.season_id, m.home_team_id AS team_id, m.phase_id FROM matches m
            WHERE m.status = 'finished' AND m.season_id IN (SELECT id FROM closed)
           UNION ALL
           SELECT m.season_id, m.away_team_id, m.phase_id FROM matches m
            WHERE m.status = 'finished' AND m.season_id IN (SELECT id FROM closed)
         ) x
         LEFT JOIN phases ph ON ph.id = x.phase_id
        WHERE ph.id IS NULL OR ph.kind IN ('league', 'groups')
        GROUP BY x.season_id, x.team_id
     )
     SELECT cl.id AS season_id, cl.idc, cl.competition_name, cl.season_name,
            count(*)::int AS stale_teams
       FROM closed cl
       JOIN standings st ON st.season_id = cl.id
       JOIN league_played lp ON lp.season_id = st.season_id AND lp.team_id = st.team_id
      WHERE COALESCE(st.played, 0) < lp.pj
      GROUP BY cl.id, cl.idc, cl.competition_name, cl.season_name
      ORDER BY cl.season_name DESC, cl.competition_name
      LIMIT $1`,
    [limit]
  );
  return rows.map((r) => ({
    seasonId: r.season_id,
    idc: r.idc,
    competitionName: r.competition_name,
    seasonName: r.season_name,
    staleTeams: r.stale_teams,
  }));
}

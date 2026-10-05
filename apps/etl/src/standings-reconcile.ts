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

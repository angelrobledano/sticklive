/**
 * Colisiones de refs entre entidades del MISMO tipo (#228).
 *
 * Las refs de sidgad (RFEP, FMP, FECAPA, FGP…) se importan con el ID **local de
 * cada portal**, sin namespacing, así que la MISMA ref puede designar 2-3
 * entidades distintas (p. ej. `1450` = C.E. NOIA y CH CASTELLAR). El
 * `RefResolver` resuelve el puente `source_ref`/`alt_source_refs` **globalmente**
 * → puede resolver el equipo/competición/temporada equivocado.
 *
 * Esto es SOLO LECTURA: detecta y cuenta las colisiones para (a) la guarda del
 * ciclo de importación y (b) dimensionar el namespacing/scoping pendiente. La
 * corrección (prefijo por portal + scoping del resolver + migración con HITL) es
 * un cambio aparte, no lo hace este fichero.
 */
import { db } from '@sports/db';

/** Refs (source_ref ∪ alt_source_refs) compartidas por >1 equipo. */
export const TEAM_REF_COLLISION_SQL = `
SELECT count(*)::text AS n FROM (
  SELECT ref FROM (
    SELECT id, source_ref AS ref FROM teams WHERE source_ref IS NOT NULL
    UNION ALL
    SELECT id, unnest(alt_source_refs) AS ref FROM teams
  ) x
  GROUP BY ref
  HAVING count(DISTINCT id) > 1
) y`;

/** `source_ref` (idc) compartido por >1 competición. */
export const COMPETITION_REF_COLLISION_SQL = `
SELECT count(*)::text AS n FROM (
  SELECT source_ref FROM competitions WHERE source_ref IS NOT NULL
  GROUP BY source_ref HAVING count(*) > 1
) y`;

/** `source_ref` (idc) compartido por >1 temporada. */
export const SEASON_REF_COLLISION_SQL = `
SELECT count(*)::text AS n FROM (
  SELECT source_ref FROM seasons WHERE source_ref IS NOT NULL
  GROUP BY source_ref HAVING count(*) > 1
) y`;

/** Total de refs colisionadas (equipos + competiciones + temporadas) en una consulta. */
export const REF_COLLISION_TOTAL_SQL = `
SELECT (
  (SELECT count(*) FROM (SELECT ref FROM (SELECT id, source_ref AS ref FROM teams WHERE source_ref IS NOT NULL
     UNION ALL SELECT id, unnest(alt_source_refs) FROM teams) x GROUP BY ref HAVING count(DISTINCT id) > 1) y1)
  + (SELECT count(*) FROM (SELECT source_ref FROM competitions WHERE source_ref IS NOT NULL GROUP BY source_ref HAVING count(*) > 1) y2)
  + (SELECT count(*) FROM (SELECT source_ref FROM seasons WHERE source_ref IS NOT NULL GROUP BY source_ref HAVING count(*) > 1) y3)
)::text AS n`;

export interface RefCollisions { teams: number; competitions: number; seasons: number }

async function count(sql: string): Promise<number> {
  const { rows } = await db.query<{ n: string }>(sql);
  return Number(rows[0]?.n ?? 0);
}

/** Colisiones por tipo de entidad. 0 = ninguna ref compartida. */
export async function countRefCollisions(): Promise<RefCollisions> {
  const [teams, competitions, seasons] = await Promise.all([
    count(TEAM_REF_COLLISION_SQL),
    count(COMPETITION_REF_COLLISION_SQL),
    count(SEASON_REF_COLLISION_SQL),
  ]);
  return { teams, competitions, seasons };
}

import { db } from '@sports/db';

/**
 * Predicado SQL de visibilidad por calidad (migración 067). Asume que la
 * consulta tiene los alias `s` (seasons) y `c` (competitions).
 */
export const SEASON_VISIBLE_SQL = "s.data_quality = 'ok' AND c.data_quality = 'ok'";

/**
 * ¿La temporada existe y es consultable? Visible ⇔ ella y su competición en
 * 'ok'. Se usa como guarda antes de servir cualquier endpoint de temporada o
 * de partido; devuelve false tanto si no existe como si está oculta, para no
 * revelar la existencia de datos no fiables.
 */
export async function seasonVisible(seasonId: string): Promise<boolean> {
  const res = await db.query(
    `SELECT 1
       FROM seasons s
       JOIN competitions c ON c.id = s.competition_id
      WHERE s.id = $1 AND ${SEASON_VISIBLE_SQL}
      LIMIT 1`,
    [seasonId]
  );
  return (res.rowCount ?? 0) > 0;
}

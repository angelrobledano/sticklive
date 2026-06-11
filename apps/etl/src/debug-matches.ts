/**
 * Diagnóstico: estado real de los partidos de la temporada activa en DB.
 * Uso: npx tsx --env-file=.env apps/etl/src/debug-matches.ts
 */
import { db, closeDb } from '@sports/db';

void (async () => {
  const seasonId = process.env['SEASON_ID'];
  const { rows } = await db.query(
    `SELECT m.source_ref, m.status, m.home_score, m.away_score,
            to_char(m.scheduled_at, 'DD/MM HH24:MI') AS fecha,
            ht.short_name AS local, at.short_name AS visitante
     FROM matches m
     LEFT JOIN teams ht ON ht.id = m.home_team_id
     LEFT JOIN teams at ON at.id = m.away_team_id
     WHERE m.season_id = $1
     ORDER BY m.scheduled_at`,
    [seasonId]
  );
  console.table(rows);
  console.log(`Total: ${rows.length} partidos (season ${seasonId})`);
  await closeDb();
})();

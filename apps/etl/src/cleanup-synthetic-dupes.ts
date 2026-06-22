/**
 * Limpieza: elimina partidos con ref sintética que duplican un partido real.
 *
 * Origen del problema: el calendario del playoff (idc 3481) lista cada
 * eliminatoria con filas placeholder sin idp (hora 00:00). El ETL las
 * insertó con source_ref 'synthetic:...' junto a las filas reales con
 * 'fep_match_{idp}', y la web mostraba los placeholders como "En juego 0-0".
 *
 * Criterio de borrado: sintético cuyo (season, local, visitante, fecha)
 * coincide con un partido real. Los sintéticos SIN partido real (series
 * futuras aún sin idp) se conservan: son la única referencia del cruce.
 *
 * Uso: npx tsx --env-file=.env apps/etl/src/cleanup-synthetic-dupes.ts
 */
import { db, closeDb } from '@sports/db';

void (async () => {
  const { rows } = await db.query(
    `DELETE FROM matches s
     USING matches r
     WHERE s.source_ref LIKE 'synthetic:%'
       AND r.source_ref NOT LIKE 'synthetic:%'
       AND r.season_id    = s.season_id
       AND r.home_team_id = s.home_team_id
       AND r.away_team_id = s.away_team_id
       -- Día en hora española (evita el desfase UTC del placeholder a las 00:00)
       AND (r.scheduled_at AT TIME ZONE 'Europe/Madrid')::date
         = (s.scheduled_at AT TIME ZONE 'Europe/Madrid')::date
     RETURNING s.source_ref`
  );
  console.log(`🧹 Eliminados ${rows.length} placeholders sintéticos duplicados:`);
  for (const r of rows) console.log('  -', r.source_ref);

  // Sintéticos huérfanos con fecha pasada: el partido no se jugó o la fuente
  // lo publicará como partido real (con idp) cuando ocurra. Son fantasmas.
  const stale = await db.query(
    `DELETE FROM matches
     WHERE source_ref LIKE 'synthetic:%'
       AND status = 'scheduled'
       AND scheduled_at < NOW() - INTERVAL '6 hours'
     RETURNING source_ref`
  );
  console.log(`👻 Eliminados ${stale.rows.length} placeholders pasados sin partido real:`);
  for (const r of stale.rows) console.log('  -', r.source_ref);
  await closeDb();
})();

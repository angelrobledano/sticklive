/**
 * Limpieza: elimina partidos con ref sintética que duplican un partido real.
 *
 * Origen del problema: el calendario del playoff (idc 3481) lista cada
 * eliminatoria con filas placeholder sin idp (hora 00:00). El ETL las
 * insertó con source_ref 'synthetic:...' junto a las filas reales con
 * 'fep_match_{idp}', y la web mostraba los placeholders como "En juego 0-0".
 *
 * Ejecuta la misma limpieza que el pipeline tras cada carga
 * (`reconcileSyntheticMatches`) sobre TODAS las temporadas: sintéticos con
 * partido real del mismo cruce y día, sintéticos duplicados entre sí y
 * placeholders pasados sin partido real. Antes duplicaba aquí las consultas;
 * ahora comparte la función para que los borrados dejen su redirección al
 * partido que los sustituye (F1-7, migración 073) y no haya dos criterios.
 *
 * Uso: npx tsx --env-file=.env apps/etl/src/cleanup-synthetic-dupes.ts
 */
import { closeDb, reconcileSyntheticMatches } from '@sports/db';

void (async () => {
  const removed = await reconcileSyntheticMatches(null);
  console.log(`🧹 Eliminados ${removed} placeholders sintéticos (duplicados, sustituidos o pasados).`);
  await closeDb();
})();

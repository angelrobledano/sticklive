-- ============================================================
-- 052 — Índice por player_id en match_events (tabla particionada).
--
-- CONTEXTO (evidencia real, EXPLAIN ANALYZE sobre copia de prod, sept 2026):
--   · match_events tiene 1,49M filas y NINGÚN índice por player_id.
--   · Los endpoints ACTUALES (player-detail, season-stats) acotan SIEMPRE por
--     temporada/partido primero (JOIN a matches / seasons.is_current) y resuelven
--     por idx_match_events_match (match_id): Index Scan, 2–8 ms. NO hacen Seq Scan.
--   · El predicado AISLADO `WHERE player_id = $1` (sin acotar por temporada) sí
--     hace Parallel Seq Scan de 1,49M (~41 ms). Hoy no lo ejecuta ninguna ruta;
--     lo hará la ficha histórica del jugador (career/all-time), en backlog.
--
--   => Este índice es DEFENSIVO/futuro, no arregla un cuello actual. Coste bajo
--      (~1,49M entradas parciales). Se documenta así a propósito: "no optimizar
--      sin evidencia" — la evidencia dice que hoy previene una regresión futura,
--      no una latencia presente.
--
-- POR QUÉ `IF NOT EXISTS` Y NO `CONCURRENTLY` AQUÍ:
--   El runner (migrate.ts) manda el fichero como una sola cadena => transacción
--   implícita, donde CONCURRENTLY no puede correr. Además, sobre una tabla
--   PARTICIONADA, `CREATE INDEX CONCURRENTLY` no está soportado sobre el padre.
--
--   En una BD pequeña o recién creada (CI, dev), este CREATE INDEX construye el
--   índice al vuelo en todas las particiones con un lock de ms — irrelevante.
--
--   En PRODUCCIÓN (1,49M filas + el ETL escribiendo cada 45 s) un CREATE INDEX
--   sobre el padre tomaría ACCESS EXCLUSIVE por partición y pararía las escrituras
--   del directo unos segundos. Por eso, en prod se construye ANTES y SIN bloqueo
--   siguiendo docs/runbook-indices-grandes.md (CREATE INDEX ... ON ONLY el padre
--   + CREATE INDEX CONCURRENTLY por partición + ATTACH PARTITION). Hecho eso, este
--   `IF NOT EXISTS` encuentra el índice ya creado y NO hace nada (no-op, sin lock).
--
--   Invariante operativa: para índices nuevos sobre match_events / match_lineups
--   (tablas grandes), ejecutar el runbook en prod ANTES de desplegar la migración.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_match_events_player
  ON match_events (player_id)
  WHERE player_id IS NOT NULL;

COMMENT ON INDEX idx_match_events_player IS
  'Acceso por jugador sin acotar por temporada (ficha histórica del jugador). En prod se crea sin bloqueo por particiones vía docs/runbook-indices-grandes.md; esta migración es no-op si ya existe.';

-- ============================================================
-- Migración 005: Referencias alternativas de equipo
--
-- Algunos scrapers usan sistemas de IDs distintos para el mismo
-- club (ej: rfep_mc_1.php usa club_44 mientras el calendario usa
-- 3373 para Hockey Club Liceo). En lugar de tener un único
-- source_ref, los equipos pueden acumular refs adicionales para
-- que el ResRef las encuentre sin ambigüedad.
--
-- Uso:
--   UPDATE teams SET alt_source_refs = array_append(alt_source_refs, 'fep_club_44')
--   WHERE source_ref = '3373';
-- ============================================================

ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS alt_source_refs text[] NOT NULL DEFAULT '{}';

-- Índice GIN para búsquedas eficientes con ANY/=
CREATE INDEX IF NOT EXISTS idx_teams_alt_source_refs
  ON teams USING GIN (alt_source_refs);

COMMENT ON COLUMN teams.alt_source_refs IS
  'IDs alternativos de fuentes externas para este equipo. '
  'Usados por RefResolver cuando source_ref no coincide con el ref '
  'generado por el scraper (distintos sistemas de IDs dentro del mismo proveedor).';

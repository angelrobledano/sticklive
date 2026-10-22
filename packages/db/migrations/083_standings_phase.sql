-- ============================================================
-- 083 — Clasificación ligada a su FASE (A7)
--
-- `standings` era única por (temporada, equipo, grupo). Con dos liguillas
-- seguidas en la misma temporada (fase regular + segunda fase, frecuente en
-- base y en FECAPA: "FEM 17 PLATA 1" / "FEM 17 PLATA 2") la segunda pisaba a
-- la primera, y la API atribuía la tabla a la primera liguilla por el título.
--
-- `phase_id` (nullable) la liga a su fase. La unicidad pasa a incluirla: con
-- phase_id NULL el comportamiento es idéntico al de antes (COALESCE a '').
-- Aditiva: no reescribe datos.
-- ============================================================

ALTER TABLE standings ADD COLUMN IF NOT EXISTS phase_id UUID REFERENCES phases(id);
CREATE INDEX IF NOT EXISTS idx_standings_phase ON standings (phase_id) WHERE phase_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_standings_season_phase_team_group
  ON standings (season_id, team_id, COALESCE(phase_id::text, ''), COALESCE(group_name, ''));
DROP INDEX IF EXISTS uq_standings_season_team_group;

COMMENT ON COLUMN standings.phase_id IS
  'Fase a la que pertenece la tabla (A7). NULL = clasificación de temporada sin fase identificada (comportamiento previo).';

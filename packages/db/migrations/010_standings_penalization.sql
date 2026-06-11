-- ============================================================
-- Migración 010: puntos de sanción en la clasificación
-- La API (season-overview, team-detail) ya esperaba esta columna;
-- en OK Liga existen deducciones de puntos por sanción federativa.
-- ============================================================

ALTER TABLE standings ADD COLUMN IF NOT EXISTS penalization_points INTEGER;

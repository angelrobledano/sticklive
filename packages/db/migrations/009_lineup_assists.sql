-- ============================================================
-- Migración 009: asistencias por jugador en la alineación
-- Fuente: columna "As" de las tablas competiciones_tabla_basic
-- de la ficha resumen.
-- ============================================================

ALTER TABLE match_lineups ADD COLUMN IF NOT EXISTS assists INTEGER NOT NULL DEFAULT 0;

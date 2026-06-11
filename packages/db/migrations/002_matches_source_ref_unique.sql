-- Migración 002: índice único en matches.source_ref
-- Necesario para el ON CONFLICT del ETL.
-- source_ref puede ser NULL (partidos sin ref de fuente), por eso el índice
-- filtra NULLs — PostgreSQL los ignora en UNIQUE por defecto.

CREATE UNIQUE INDEX IF NOT EXISTS idx_matches_source_ref_unique
  ON matches(source_ref)
  WHERE source_ref IS NOT NULL;

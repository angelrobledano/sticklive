-- ============================================================
-- 080 — Nombre de presentación curado de equipos (F3-2).
--
-- La fuente publica casi todo en mayúsculas ("C.E. NOIA FREIXENET") y la
-- normalización heurística no siempre acierta con siglas y patrocinadores.
-- `display_name` es el nombre editable desde /admin; las lecturas públicas
-- usan COALESCE(display_name, name), así que un equipo sin curar sigue
-- mostrando el nombre de la fuente.
--
-- No se toca ningún dato existente: la columna nace NULL. El ETL no la
-- escribe (sus upserts no la incluyen), de modo que una edición manual no se
-- pierde en la siguiente pasada.
-- ============================================================

ALTER TABLE teams ADD COLUMN IF NOT EXISTS display_name TEXT;

COMMENT ON COLUMN teams.display_name IS
  'Nombre de presentación curado desde /admin (F3-2). NULL = usar teams.name.';

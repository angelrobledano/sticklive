-- ============================================================
-- 062 — Grupo de la fase de grupos en los partidos
--
-- Las competiciones por grupos (World Skate Games, europeos WSE) juegan una
-- fase de grupos y una fase final en la MISMA temporada. Las clasificaciones
-- ya llevan `group_name`; los partidos no podían agruparse por grupo (columna
-- inexistente), lo que impedía filtrar "solo el Grupo A" en calendario y
-- comprobar la integridad de grupos en los tests.
--
-- NULL = partido sin grupo (ligas a partido único, eliminatorias).
-- ============================================================

ALTER TABLE matches ADD COLUMN IF NOT EXISTS group_name TEXT;

COMMENT ON COLUMN matches.group_name IS
  'Grupo de la fase de grupos del partido ("A", "B", "Norte"...). NULL = fase sin grupos (eliminatorias) o fuente sin grupos.';

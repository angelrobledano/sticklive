-- ============================================================
-- 082 — Ref de inscripción de la fuente en la INSCRIPCIÓN (A5)
--
-- El `teamId` de sidgad no identifica a un equipo: identifica su inscripción
-- en una competición y temporada (cambia cada temporada, y cada portal numera
-- aparte). Hasta ahora se acumulaba en `teams.alt_source_refs`, un array
-- GLOBAL: la misma ref podía casar con 2-3 equipos de portales distintos
-- (#228, `1450` = C.E. NOIA y CH CASTELLAR) y un re-scrape de temporadas
-- pasadas traía refs nuevas que no resolvían y duplicaban equipos.
--
-- `season_teams.source_ref` la guarda donde pertenece. Una temporada es de un
-- solo portal, así que (temporada, ref) es determinista. El RefResolver la
-- consulta primero cuando conoce la temporada. `alt_source_refs` se mantiene
-- como respaldo para lo ya cargado.
--
-- Aditiva e idempotente.
-- ============================================================

ALTER TABLE season_teams ADD COLUMN IF NOT EXISTS source_ref TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_season_teams_source_ref
  ON season_teams (season_id, source_ref) WHERE source_ref IS NOT NULL;

COMMENT ON COLUMN season_teams.source_ref IS
  'Id de inscripción de la fuente (teamId sidgad) para ESTA temporada. Único por temporada (A5).';

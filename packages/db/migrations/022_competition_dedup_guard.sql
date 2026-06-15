-- ============================================================
-- Migración 022: guardia anti-duplicados en competiciones
--
-- Problema: el scraper crea una competición nueva por cada edición
-- de la fuente ("XXVIII CTO ESPAÑA", "CTO ESPAÑA 2011", etc.).
-- merge-canonical-competitions.ts las fusiona a posteriori, pero
-- no hay nada que avise en el momento de la inserción.
--
-- Solución:
--   1. Función pg_trgm que detecta nombres muy similares.
--   2. Trigger BEFORE INSERT que emite un NOTICE con las colisiones
--      (NOTICE, no ERROR: no bloqueamos el ETL, solo avisamos).
--   3. Vista materializable `v_competition_duplicates` para auditoría
--      desde el panel de admin.
--
-- Requiere: extensión pg_trgm (ya activa desde migración 001).
-- ============================================================

-- ── 1. Función de búsqueda de similares ──────────────────────────────────────
--
-- Devuelve las competiciones del mismo sport cuyo nombre tiene similitud
-- pg_trgm ≥ threshold con el nombre consultado.
-- No compara con sí misma ni con competiciones archivadas.
CREATE OR REPLACE FUNCTION fn_similar_competitions(
  p_sport_id  UUID,
  p_name      TEXT,
  p_self_id   UUID    DEFAULT NULL,   -- excluir el propio registro en UPDATEs
  p_threshold FLOAT   DEFAULT 0.6
)
RETURNS TABLE(id UUID, name TEXT, similarity FLOAT)
LANGUAGE SQL STABLE AS $$
  SELECT
    c.id,
    c.name,
    similarity(c.name, p_name)::float AS similarity
  FROM competitions c
  WHERE c.sport_id    = p_sport_id
    AND c.archived_at IS NULL
    AND (p_self_id IS NULL OR c.id <> p_self_id)
    AND similarity(c.name, p_name) >= p_threshold
  ORDER BY similarity DESC;
$$;

-- ── 2. Trigger anti-duplicados en INSERT ─────────────────────────────────────
--
-- Emite NOTICE (visible en logs pero no bloquea) listando las competiciones
-- similares. Si el llamador quiere convertirlo en error, puede hacerlo
-- capturando el NOTICE; en producción, queda en el log del servidor.
CREATE OR REPLACE FUNCTION fn_check_competition_dedup()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  rec RECORD;
  found_any BOOLEAN := FALSE;
BEGIN
  FOR rec IN
    SELECT sc.id, sc.name, sc.similarity
      FROM fn_similar_competitions(NEW.sport_id, NEW.name, NEW.id, 0.7) sc
  LOOP
    IF NOT found_any THEN
      RAISE NOTICE 'DEDUP WARNING: la competición "%" (sport_id=%) es muy similar a competiciones existentes:',
        NEW.name, NEW.sport_id;
      found_any := TRUE;
    END IF;
    RAISE NOTICE '  → "%" (id=%, similitud=%.2f) — considera fusionarlas.',
      rec.name, rec.id, rec.similarity;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_competition_dedup_check ON competitions;
CREATE TRIGGER trg_competition_dedup_check
  BEFORE INSERT ON competitions
  FOR EACH ROW
  EXECUTE FUNCTION fn_check_competition_dedup();

-- ── 3. Vista de duplicados potenciales para el panel de admin ────────────────
--
-- Pares de competiciones del mismo sport con similitud > 0.6.
-- Se usa en GET /admin/competitions/duplicates.
-- No es una vista materializada (no hay pg_matview en PG < 14 con refresh
-- automático); se recalcula en cada consulta pero es rara (solo admin).
CREATE OR REPLACE VIEW v_competition_duplicates AS
SELECT
  a.id           AS id_a,
  a.name         AS name_a,
  a.slug         AS slug_a,
  b.id           AS id_b,
  b.name         AS name_b,
  b.slug         AS slug_b,
  similarity(a.name, b.name)::float AS sim,
  a.sport_id
FROM competitions a
JOIN competitions b
  ON b.sport_id = a.sport_id
 AND b.id > a.id                    -- cada par una sola vez (B > A)
 AND similarity(a.name, b.name) >= 0.6
WHERE a.archived_at IS NULL
  AND b.archived_at IS NULL
ORDER BY sim DESC, a.name;

-- ── 4. Índice GIN para acelerar similarity() ─────────────────────────────────
-- pg_trgm ya crea índices GIN para LIKE/ILIKE, pero similarity() también
-- los aprovecha si hay un índice GIN en la columna.
CREATE INDEX IF NOT EXISTS idx_competitions_name_trgm
  ON competitions USING GIN (name gin_trgm_ops);

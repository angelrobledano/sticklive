-- ============================================================
-- 075 — Cuándo se ocultó una competición o temporada (F1-6).
--
-- `data_quality = 'en_revision'` (064/067) oculta el contenido y la API
-- responde 404 en sus fichas. Para Google es una baja: si la revisión dura
-- unas horas y se reabre, la URL tiene que volver a ganarse. Con la fecha de
-- la ocultación, la web responde 5xx durante un periodo de gracia (Google
-- reintenta y conserva la URL) y 404 cuando la revisión se alarga. Ver DQ-01
-- y §5.3 de docs/AUDITORIA_SEO_2026-10-16.md.
--
-- Trigger BEFORE UPDATE: la fecha la pone la base al cambiar el valor, venga
-- del panel de admin, de un endpoint o de un UPDATE a mano. Tocar otras
-- columnas no la mueve.
--
-- Sin backfill: lo que ya estaba oculto queda con NULL ("desde hace tiempo"),
-- que la web trata como revisión larga (404, el comportamiento de antes).
--
-- Idempotente y aditiva.
-- ============================================================

ALTER TABLE competitions ADD COLUMN IF NOT EXISTS data_quality_changed_at TIMESTAMPTZ;
ALTER TABLE seasons      ADD COLUMN IF NOT EXISTS data_quality_changed_at TIMESTAMPTZ;

COMMENT ON COLUMN competitions.data_quality_changed_at IS
  'Último cambio de data_quality (lo fija un trigger). NULL = sin cambios desde la 075. Ver migración 075.';
COMMENT ON COLUMN seasons.data_quality_changed_at IS
  'Último cambio de data_quality (lo fija un trigger). NULL = sin cambios desde la 075. Ver migración 075.';

CREATE OR REPLACE FUNCTION fn_touch_data_quality_changed_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.data_quality_changed_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_competitions_data_quality_changed ON competitions;
CREATE TRIGGER trg_competitions_data_quality_changed
  BEFORE UPDATE OF data_quality ON competitions
  FOR EACH ROW
  WHEN (OLD.data_quality IS DISTINCT FROM NEW.data_quality)
  EXECUTE FUNCTION fn_touch_data_quality_changed_at();

DROP TRIGGER IF EXISTS trg_seasons_data_quality_changed ON seasons;
CREATE TRIGGER trg_seasons_data_quality_changed
  BEFORE UPDATE OF data_quality ON seasons
  FOR EACH ROW
  WHEN (OLD.data_quality IS DISTINCT FROM NEW.data_quality)
  EXECUTE FUNCTION fn_touch_data_quality_changed_at();

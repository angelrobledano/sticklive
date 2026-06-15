-- ============================================================
-- Migración 021: archivado de competiciones inactivas
--
-- Una competición ACTIVA cumple al menos una de estas condiciones:
--   a) tiene alguna temporada marcada is_current = TRUE
--   b) su temporada más reciente CON partidos empezó hace < 2 años
--
-- Una competición ARCHIVADA:
--   • No aparece en listados, búsquedas ni filtros.
--   • Sigue siendo accesible por URL directa o vistas históricas.
--   • Se reactiva automáticamente al recibir una nueva temporada
--     (ver trigger en esta misma migración).
--
-- Idempotente: usa ADD COLUMN IF NOT EXISTS y CREATE ... IF NOT EXISTS.
-- ============================================================

-- ── 1. Columna ────────────────────────────────────────────────────────────────
ALTER TABLE competitions
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- Índice parcial: la mayoría de las competiciones serán NULL (activas).
-- Solo indexamos las archivadas para que filtrar "activas" sea un seq scan
-- selectivo en vez de un index scan inverso (más barato con muchas activas).
CREATE INDEX IF NOT EXISTS idx_competitions_archived
  ON competitions(archived_at)
  WHERE archived_at IS NOT NULL;

-- ── 2. Función de reactivación (usada por trigger en seasons) ────────────────
--
-- Cuando se inserta o actualiza una temporada cuya competición está
-- archivada, la reactiva automáticamente.  Así el scraper no necesita
-- saber nada del estado de archivado: simplemente carga datos y el
-- sistema se autocorrige.
CREATE OR REPLACE FUNCTION fn_reactivate_competition_on_season()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Solo actuamos si la competición está archivada
  UPDATE competitions
     SET archived_at = NULL,
         updated_at  = NOW()
   WHERE id = NEW.competition_id
     AND archived_at IS NOT NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reactivate_competition ON seasons;
CREATE TRIGGER trg_reactivate_competition
  AFTER INSERT OR UPDATE OF competition_id ON seasons
  FOR EACH ROW
  EXECUTE FUNCTION fn_reactivate_competition_on_season();

-- ── 3. Backfill ───────────────────────────────────────────────────────────────
--
-- Archivamos en dos pasadas, de menos a más agresiva:
--
-- PASADA A: competiciones sin ninguna temporada con partidos.
-- Son "cáscaras vacías" creadas por el scraper pero nunca pobladas.
-- El umbral temporal no aplica: si no hay datos, se archiva.
UPDATE competitions c
   SET archived_at = NOW()
 WHERE c.archived_at IS NULL
   AND NOT EXISTS (
     SELECT 1
       FROM seasons s
       JOIN matches m ON m.season_id = s.id
      WHERE s.competition_id = c.id
     LIMIT 1
   );

-- PASADA B: competiciones cuya actividad más reciente lleva > 2 años
-- sin ninguna temporada marcada como is_current.
--
-- "Actividad reciente" = MAX(COALESCE(end_date, start_date)) de las
-- temporadas con partidos.  Si no hay fechas en seasons, usamos
-- MAX(m.scheduled_at) como proxy de actividad real.
WITH activity AS (
  SELECT
    c.id                          AS competition_id,
    BOOL_OR(s.is_current)        AS has_current,
    -- Fecha más reciente de season (end_date > start_date > NULL)
    MAX(
      GREATEST(
        s.end_date,
        s.start_date
      )
    )                             AS last_season_date,
    -- Partido más reciente como fallback cuando las fechas de season son NULL
    MAX(m.scheduled_at)::date     AS last_match_date
  FROM competitions c
  JOIN seasons s ON s.competition_id = c.id
  JOIN matches  m ON m.season_id = s.id
  GROUP BY c.id
)
UPDATE competitions c
   SET archived_at = NOW()
  FROM activity a
 WHERE a.competition_id = c.id
   AND c.archived_at IS NULL      -- ya archivadas en pasada A: no tocar
   AND a.has_current = FALSE
   AND COALESCE(a.last_season_date, a.last_match_date) < CURRENT_DATE - INTERVAL '2 years';

-- ── 4. Estadísticas del backfill (solo informativo, no falla) ────────────────
DO $$
DECLARE
  v_archived   int;
  v_total      int;
BEGIN
  SELECT COUNT(*) INTO v_total    FROM competitions;
  SELECT COUNT(*) INTO v_archived FROM competitions WHERE archived_at IS NOT NULL;
  RAISE NOTICE 'Competiciones archivadas: % / % totales (activas: %)',
    v_archived, v_total, v_total - v_archived;
END $$;

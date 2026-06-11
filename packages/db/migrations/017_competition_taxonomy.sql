-- ============================================================
-- Migración 017: taxonomía de competiciones
--
-- Prepara el modelo para federaciones autonómicas y categorías base:
--   organizer    → quién organiza (RFEP, FMP, FAP, FPCV, ...)
--   scope        → national | regional | international
--   region       → comunidad autónoma para las regionales
--   age_category → escala cerrada de categorías de edad
--
-- Backfill: todo lo existente es RFEP/nacional; la categoría de edad
-- se infiere del nombre (la nomenclatura de la fuente es regular).
-- ============================================================

ALTER TABLE competitions ADD COLUMN IF NOT EXISTS organizer TEXT NOT NULL DEFAULT 'RFEP';
ALTER TABLE competitions ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'national'
  CHECK (scope IN ('national', 'regional', 'international'));
ALTER TABLE competitions ADD COLUMN IF NOT EXISTS region TEXT;
ALTER TABLE competitions ADD COLUMN IF NOT EXISTS age_category TEXT NOT NULL DEFAULT 'senior'
  CHECK (age_category IN ('senior','juvenil','junior','infantil','alevin','benjamin','prebenjamin','veteranos','base'));

CREATE INDEX IF NOT EXISTS idx_competitions_taxonomy
  ON competitions(scope, organizer, age_category);

-- ── Backfill de age_category por nomenclatura del nombre ─────
UPDATE competitions SET age_category = 'juvenil'     WHERE name ~* 'JUVENIL';
UPDATE competitions SET age_category = 'junior'      WHERE name ~* 'JUNIOR|JÚNIOR';
UPDATE competitions SET age_category = 'infantil'    WHERE name ~* 'INFANTIL';
UPDATE competitions SET age_category = 'alevin'      WHERE name ~* 'ALEVIN|ALEVÍN';
UPDATE competitions SET age_category = 'benjamin'    WHERE name ~* 'BENJAMIN|BENJAMÍN';
UPDATE competitions SET age_category = 'prebenjamin' WHERE name ~* 'PREBENJAMIN|PRE-BENJAMIN|PREBENJAMÍN';
UPDATE competitions SET age_category = 'veteranos'   WHERE name ~* 'VETERAN';
-- Sub-XX: mundiales/europeos de categorías inferiores → base
UPDATE competitions SET age_category = 'base'        WHERE name ~* 'SUB-?\s?(15|17|19|20|23)' AND age_category = 'senior';

-- ── Backfill de scope para internacionales evidentes ─────────
UPDATE competitions SET scope = 'international'
WHERE name ~* 'MUNDO|MUNDIAL|EURO ?HOCKEY|EUROPEO|WORLD|GOLDEN CUP|LATIN'
  AND scope = 'national';

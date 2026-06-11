-- ============================================================
-- Migración 004: Competición y temporada del Playoff
-- idc sidgad: 3481
-- URL FEP: https://www.hockeypatines.fep.es/league/3481
--
-- Se inserta como competición independiente de la OK Liga regular
-- para no mezclar calendarios ni clasificaciones.
-- La temporada se marca is_current=TRUE para que los scrapers la
-- encuentren en el lookup dinámico de arranque.
-- ============================================================

-- 1. Competición Playoff OK Liga
INSERT INTO competitions (
  sport_id,
  name,
  short_name,
  slug,
  gender,
  category,
  country,
  source_ref,
  source_url
)
SELECT
  s.id,
  'OK Liga Masculina Playoff',
  'OKL Playoff',
  'ok-liga-masculina-playoff',
  'male',
  'senior',
  'ES',
  'fep_competition_3481',
  'https://www.hockeypatines.fep.es/league/3481'
FROM sports s
WHERE s.slug = 'hockey-patines'
ON CONFLICT (sport_id, slug) DO UPDATE SET
  name       = EXCLUDED.name,
  source_ref = EXCLUDED.source_ref,
  source_url = EXCLUDED.source_url,
  updated_at = NOW();

-- 2. Temporada actual del Playoff (2024/25)
-- temp sidgad = 39 (2025 = temporada en curso a mayo 2026)
INSERT INTO seasons (
  competition_id,
  name,
  slug,
  start_date,
  end_date,
  is_current,
  source_ref
)
SELECT
  c.id,
  '2024/25',
  '2024-25',
  '2025-04-01',   -- fecha aproximada de inicio del playoff
  '2025-06-30',   -- fecha aproximada de final
  TRUE,
  'fep_season_3481_39'
FROM competitions c
WHERE c.source_ref = 'fep_competition_3481'
ON CONFLICT (competition_id, slug) DO UPDATE SET
  is_current = TRUE,
  source_ref = EXCLUDED.source_ref,
  updated_at = NOW();

-- Nota: el índice idx_seasons_one_current garantiza que solo hay una temporada
-- is_current=TRUE POR competición, no globalmente. El playoff y la OK Liga
-- regular pueden coexistir con is_current=TRUE cada una en su competición.

-- ============================================================
-- 100 — Curación de competiciones destacadas (spec 2026-10-30)
--
-- `featured_rank` (089) pasa a ser LA definición de «destacada»: lo que sale
-- por defecto en Partidos y en la portada de Competiciones. NULL = disponible
-- (catálogo, Explorar, búsqueda, y en Partidos solo si se sigue). Regla en
-- @sports/shared-types (`feedReason`) y en la API (`scope=feed`).
--
-- Rangos (orden en la portada, sin más significado):
--    1–9   principales: OK Liga, Placard, Iberdrola, Serie A1 (WSE Champions
--          cuando exista: se le da rango desde el admin)
--   10–19  internacionales (World Skate)
--   20–39  segundo nivel nacional y sus eliminatorias
--   40–59  copas y supercopas
--
-- `tier` es nivel deportivo de LIGA (1 = máxima). Las copas no lo tienen: un
-- tier 1 se ve en Partidos aunque el usuario prefiera otro país, y eso es para
-- las grandes ligas, no para la Taça o la Coppa Italia.
--
-- Idempotente: por slug. Las competiciones que aún no existan se ignoran.
-- ============================================================

-- 1. Nadie destacado salvo la lista de abajo.
UPDATE competitions SET featured_rank = NULL WHERE featured_rank IS NOT NULL;

-- 2. Copas: sin nivel de liga.
UPDATE competitions SET tier = NULL WHERE slug IN (
  'copa-del-rey', 'copa-de-la-reina-iberdrola',
  'supercopa-de-espana-masculina', 'supercopa-de-espana-femenina',
  'copa-sar-la-princesa-masculina', 'copa-sar-la-princesa-femenina',
  'taca-de-portugal', 'elite-cup-portugal', 'elite-cup-feminina-portugal',
  'supertaca-portugal', 'supertaca-feminina-portugal',
  'coppa-italia-a2', 'coppa-italia-serie-b', 'supercoppa-italiana', 'supercoppa-italiana-femminile'
);

-- 3. Destacadas.
UPDATE competitions c SET featured_rank = v.rank, tier = COALESCE(v.tier, c.tier)
FROM (VALUES
  -- principales
  ('ok-liga-masculina',                     1, 1),
  ('campeonato-placard-portugal',           2, 1),
  ('ok-liga-femenina',                      3, 1),
  ('campionato-serie-a1',                   4, 1),
  -- internacionales
  ('mundial-masculino-worldskate',         10, NULL),
  ('mundial-femenino-worldskate',          11, NULL),
  ('intercontinental-masculino-worldskate',12, NULL),
  ('mundial-sub19-masculino-worldskate',   13, NULL),
  -- segundo nivel
  ('ok-liga-plata-norte',                  20, 2),
  ('ok-liga-plata-sur',                    21, 2),
  ('ok-liga-plata-masculina-eliminatoria', 22, 2),
  ('ok-liga-plata-femenina',               23, 2),
  ('ok-liga-bronce-masculina-norte',       24, 3),
  ('ok-liga-bronce-masculina-sur',         25, 3),
  ('ok-liga-bronce-eliminatoria',          26, 3),
  ('nacional-catalana-masculina',          27, 3),
  ('nacional-catalana-femenina',           28, 3),
  ('campeonato-nacional-feminino-portugal',29, 2),
  ('2-divisao-portugal',                   30, 2),
  ('campionato-serie-a2',                  31, 2),
  -- copas
  ('copa-del-rey',                         40, NULL),
  ('copa-de-la-reina-iberdrola',           41, NULL),
  ('supercopa-de-espana-masculina',        42, NULL),
  ('supercopa-de-espana-femenina',         43, NULL),
  ('copa-sar-la-princesa-masculina',       44, NULL),
  ('copa-sar-la-princesa-femenina',        45, NULL),
  ('taca-de-portugal',                     46, NULL),
  ('elite-cup-portugal',                   47, NULL),
  ('elite-cup-feminina-portugal',          48, NULL),
  ('supertaca-portugal',                   49, NULL),
  ('supertaca-feminina-portugal',          50, NULL),
  ('coppa-italia-a2',                      51, NULL),
  ('supercoppa-italiana',                  52, NULL),
  ('supercoppa-italiana-femminile',        53, NULL)
) AS v(slug, rank, tier)
WHERE c.slug = v.slug;

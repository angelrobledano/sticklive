-- ============================================================
-- 089 — Federaciones como entidad + importancia en datos
--
-- Zona de competiciones (plan-zona-competiciones.md):
--
--   federations        → árbol world → continental → national → regional.
--                         `code` coincide con competitions.organizer (texto
--                         que ya escriben todos los seeds), así que no hay que
--                         tocar la ingesta: el JOIN es por código.
--   competitions.tier  → nivel deportivo dentro de su federación
--                         (1 = máxima categoría). NULL = sin clasificar.
--   competitions.featured_rank → curación editorial global ("Destacadas").
--                         NULL = no destacada. Sustituye al mapa IMPORTANCE
--                         que vivía en el front.
--
-- Sin FK organizer → federations a propósito: un organizer nuevo no debe
-- romper un seed. Un organizer sin federación sale en "Otras" y lo detecta
-- el test de integración / la consulta de control del final.
-- Aditiva e idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS federations (
  code          TEXT PRIMARY KEY,               -- = competitions.organizer
  slug          TEXT NOT NULL UNIQUE,           -- segmento de URL del hub
  name          TEXT NOT NULL,
  short_name    TEXT NOT NULL,
  level         TEXT NOT NULL CHECK (level IN ('world', 'continental', 'national', 'regional')),
  parent_code   TEXT REFERENCES federations(code),
  country       TEXT,                           -- ISO-2; NULL en world/continental
  region        TEXT,                           -- solo regional
  website       TEXT,
  display_order SMALLINT NOT NULL DEFAULT 100,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_federations_parent  ON federations(parent_code);
CREATE INDEX IF NOT EXISTS idx_federations_country ON federations(country);

-- Orden de inserción: padres antes que hijos (parent_code es FK).
INSERT INTO federations (code, slug, name, short_name, level, parent_code, country, region, website, display_order) VALUES
  ('World Skate', 'world-skate', 'World Skate',                                  'World Skate', 'world',       NULL,          NULL, NULL, 'https://www.worldskate.org/', 1),
  ('WSE',         'wse',         'World Skate Europe',                           'WSE',         'continental', 'World Skate', NULL, NULL, 'https://wse.sidgad.com/',     2),
  ('RFEP',        'rfep',        'Real Federación Española de Patinaje',         'RFEP',        'national',    'WSE',         'ES', NULL, 'https://www.fep.es/',          10),
  ('FPP',         'fpp',         'Federação de Patinagem de Portugal',           'FPP',         'national',    'WSE',         'PT', NULL, 'https://hp.fpp.pt/',          20),
  ('FISR',        'fisr',        'Federazione Italiana Sport Rotellistici',      'FISR',        'national',    'WSE',         'IT', NULL, 'https://hockeypista.fisr.it/', 30),
  ('FECAPA',      'fecapa',      'Federació Catalana de Patinatge',              'FECAPA',      'regional',    'RFEP',        'ES', 'Cataluña',             'https://www.fecapa.cat/', 110),
  ('FPCV',        'fpcv',        'Federació de Patinatge de la Comunitat Valenciana', 'FPCV',   'regional',    'RFEP',        'ES', 'Comunidad Valenciana', 'https://www.hockeypatines.fpcv.es/', 120),
  ('FGP',         'fgp',         'Federación Galega de Patinaxe',                'FGP',         'regional',    'RFEP',        'ES', 'Galicia',              'https://www.hockeypatines.fgpatinaxe.gal/', 130),
  ('FMP',         'fmp',         'Federación Madrileña de Patinaje',             'FMP',         'regional',    'RFEP',        'ES', 'Madrid',               'https://www.hockeypatines.fmp.es/', 140),
  ('FAP',         'fap',         'Federación Andaluza de Patinaje',              'FAP',         'regional',    'RFEP',        'ES', 'Andalucía',            'https://www.hockeypatines.fapatinaje.org/', 150),
  ('FVP',         'fvp',         'Federación Vasca de Patinaje',                 'FVP',         'regional',    'RFEP',        'ES', 'País Vasco',           NULL, 160),
  ('FNP',         'fnp',         'Federación Navarra de Patinaje',               'FNP',         'regional',    'RFEP',        'ES', 'Navarra',              'https://www.hockey.fnp.org/', 170),
  ('FPCYL',       'fpcyl',       'Federación de Patinaje de Castilla y León',    'FPCYL',       'regional',    'RFEP',        'ES', 'Castilla y León',      'https://www.hockeypatines.fpcyl.es/', 180)
ON CONFLICT (code) DO UPDATE SET
  slug          = EXCLUDED.slug,
  name          = EXCLUDED.name,
  short_name    = EXCLUDED.short_name,
  level         = EXCLUDED.level,
  parent_code   = EXCLUDED.parent_code,
  country       = EXCLUDED.country,
  region        = EXCLUDED.region,
  website       = EXCLUDED.website,
  display_order = EXCLUDED.display_order,
  updated_at    = NOW();

-- OJO: NO se reescribe competitions.organizer. competition_portal_key() (081)
-- deriva el portal de ese texto y cambiarlo movería source_refs.

-- ── Importancia ──────────────────────────────────────────────
ALTER TABLE competitions ADD COLUMN IF NOT EXISTS tier SMALLINT
  CHECK (tier IS NULL OR tier BETWEEN 1 AND 9);
ALTER TABLE competitions ADD COLUMN IF NOT EXISTS featured_rank SMALLINT
  CHECK (featured_rank IS NULL OR featured_rank > 0);

CREATE INDEX IF NOT EXISTS idx_competitions_featured
  ON competitions(featured_rank) WHERE featured_rank IS NOT NULL;

-- Backfill de tier (solo donde está a NULL: no pisa ediciones del admin).
-- Sénior por nomenclatura de cada país. Las copas cuentan como tier 1 si son
-- la copa principal del país. Base y regionales quedan en NULL (ordenan detrás).
UPDATE competitions SET tier = CASE
    WHEN name ~* 'SUPERCOPA|SUPERTA[ÇC]A|COPA DEL REY|COPA DE LA REINA|TA[ÇC]A DE PORTUGAL|COPPA ITALIA' THEN 1
    WHEN name ~* 'OK LIGA PLATA' THEN 2
    WHEN name ~* 'OK LIGA BRONCE' THEN 3
    WHEN name ~* 'OK LIGA' THEN 1
    WHEN name ~* 'COPA S\.?A\.?R' THEN 2
    WHEN name ~* '(^|\s)1[ªa.]?\s*DIVIS[AÃ]O|CAMPEONATO NACIONAL DA 1|SERIE A1' THEN 1
    WHEN name ~* '(^|\s)2[ªa.]?\s*DIVIS[AÃ]O|SERIE A2' THEN 2
    WHEN name ~* '(^|\s)3[ªa.]?\s*DIVIS[AÃ]O|SERIE B' THEN 3
    WHEN name ~* 'PRIMERA' AND organizer = 'RFEP' THEN 4
    ELSE NULL
  END
WHERE tier IS NULL
  AND age_category = 'senior'
  AND scope IN ('national', 'international');

-- Backfill de featured_rank desde el antiguo mapa IMPORTANCE del front
-- (lib/competition-importance.ts). Solo los slugs que eran "top"; el resto de
-- la curación se hace ya en datos.
UPDATE competitions c SET featured_rank = v.rank
FROM (VALUES
  ('mundial-masculino-worldskate', 1),
  ('mundial-femenino-worldskate', 2),
  ('intercontinental-masculino-worldskate', 3),
  ('mundial-sub19-masculino-worldskate', 4),
  ('ok-liga-masculina', 5),
  ('ok-liga-femenina', 6),
  ('copa-del-rey', 7),
  ('copa-de-la-reina-iberdrola', 8),
  ('supercopa-de-espana-masculina', 9),
  ('supercopa-de-espana-femenina', 10)
) AS v(slug, rank)
WHERE c.slug = v.slug AND c.featured_rank IS NULL;

-- Portugal: liga sénior masculina y femenina de máxima categoría.
UPDATE competitions SET featured_rank = 20
WHERE featured_rank IS NULL AND organizer = 'FPP' AND tier = 1
  AND age_category = 'senior' AND gender = 'male'
  AND name !~* 'TA[ÇC]A|SUPERTA';
UPDATE competitions SET featured_rank = 21
WHERE featured_rank IS NULL AND organizer = 'FPP' AND tier = 1
  AND age_category = 'senior' AND gender = 'female'
  AND name !~* 'TA[ÇC]A|SUPERTA';

-- Consulta de control (no falla la migración): organizers sin federación.
-- SELECT DISTINCT organizer FROM competitions c
-- WHERE NOT EXISTS (SELECT 1 FROM federations f WHERE f.code = c.organizer);

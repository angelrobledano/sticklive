-- ============================================================
-- Migración 032: modelo de selecciones nacionales + fuente World Skate
--
-- Las selecciones no son clubes: un mismo país tiene varias (Sub-17 M,
-- Sub-19 M, Senior M, y las femeninas). Para que el usuario navegue
-- "país → sus selecciones" a largo plazo, la identidad de un equipo
-- nacional es país + género + categoría (el escudo es la bandera,
-- común a todas). Se discrimina de los clubes con team_type.
--
-- Además registra la fuente World Skate Europe (portal sidgad 'worldskate')
-- y añade timezone por temporada (la sede del torneo cambia cada edición:
-- Braga 2026 → Europe/Lisbon, no Europe/Madrid).
-- ============================================================

-- ── Modelo de equipos: clubes vs selecciones ────────────────
ALTER TABLE teams ADD COLUMN IF NOT EXISTS team_type TEXT NOT NULL DEFAULT 'club'
  CHECK (team_type IN ('club', 'national'));
ALTER TABLE teams ADD COLUMN IF NOT EXISTS gender TEXT
  CHECK (gender IN ('male', 'female', 'mixed', 'unknown'));
ALTER TABLE teams ADD COLUMN IF NOT EXISTS age_category TEXT;   -- 'sub17','sub19','sub20','senior'... (libre)

-- Agrupación por país (para navegación "España → todas sus selecciones").
-- Reutiliza teams.country (ISO) como clave de país; el índice acelera el listado.
CREATE INDEX IF NOT EXISTS idx_teams_national
  ON teams(team_type, country) WHERE team_type = 'national';

COMMENT ON COLUMN teams.team_type IS 'club | national — discrimina clubes de selecciones nacionales';
COMMENT ON COLUMN teams.gender IS 'Género del equipo (relevante en selecciones: masculina/femenina)';
COMMENT ON COLUMN teams.age_category IS 'Categoría de edad de la selección (sub17, sub19, senior...)';

-- ── Timezone por temporada (sede del torneo) ────────────────
ALTER TABLE seasons ADD COLUMN IF NOT EXISTS timezone TEXT;   -- IANA, ej: 'Europe/Lisbon'; NULL = usar default de la fuente
COMMENT ON COLUMN seasons.timezone IS
  'Zona horaria IANA de la sede de esta edición (los torneos itineran). '
  'El ETL la usa para convertir horas locales a UTC; NULL cae al default_timezone de la fuente.';

-- ── Fuente World Skate Europe (misma plataforma sidgad, portal worldskate) ──
INSERT INTO data_sources
  (name, base_url, scraper_key, provider, portal_prefix, request_base_url, referer, logo_base, default_timezone, notes)
VALUES
  ('World Skate Europe - Rink Hockey',
   'https://wse.sidgad.com',
   'worldskate_hockey',
   'sidgad',
   'worldskate',
   'https://www.server2.sidgad.es/worldskate',
   'https://wse.sidgad.com/',
   'https://www.sidgad.com/worldskate/images/logos_clubes/',
   'Europe/Lisbon',
   'World Skate Europe (europeos de hockey patines). Misma plataforma sidgad que la FEP, portal worldskate. La sede varía por edición: usar seasons.timezone.')
ON CONFLICT (scraper_key) DO UPDATE SET
  provider         = EXCLUDED.provider,
  portal_prefix    = EXCLUDED.portal_prefix,
  request_base_url = EXCLUDED.request_base_url,
  referer          = EXCLUDED.referer,
  logo_base        = EXCLUDED.logo_base,
  default_timezone = EXCLUDED.default_timezone,
  updated_at       = NOW();

-- 044_clubs_model.sql — Fase 0.1 del modelo de Entity Resolution (clubes)
--
-- ESTRICTAMENTE ADITIVA. Crea las tablas de identidad de club y el mapeo
-- determinista de IDs de fuente, y añade a `teams` dos columnas NULLABLE. No
-- altera ninguna columna existente ni toca `matches`/`standings`/directo: nada
-- lee todavía lo que se crea aquí. El backfill (1 club por team) y el consumo
-- van en fases posteriores (ver docs/SPEC_FASE0_MODELO_CLUBS.md).
--
-- Contexto: hoy `teams` es un "club aplanado" (ya trae gender/age_category/
-- alt_source_refs). Esta fase separa la IDENTIDAD estable (club) de sus
-- secciones (team = club × género × categoría × filial) sin fusionar nada
-- automáticamente: agrupar secciones bajo un club es ER (fases 2-3), no backfill.

-- ── Identidad estable del club (ancla del historial a 10+ años) ──────────────
CREATE TABLE IF NOT EXISTS clubs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sport_id       UUID NOT NULL REFERENCES sports(id),
  canonical_name TEXT NOT NULL,            -- nombre deportivo, sin patrocinador
  slug           TEXT NOT NULL,
  city           TEXT,
  region         TEXT,
  country        TEXT NOT NULL DEFAULT 'ES',
  founded_year   INT,
  crest_url      TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (sport_id, slug)
);

-- ── Patrocinadores (tokens a eliminar en la normalización de nombres) ────────
CREATE TABLE IF NOT EXISTS sponsors (
  id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name    TEXT NOT NULL UNIQUE,            -- "Coinasa"
  aliases TEXT[] NOT NULL DEFAULT '{}'
);

-- ── Nombre comercial con vigencia (historial de patrocinio por temporada) ────
-- El nombre NUNCA es clave: "Coinasa Liceo" y "Deportivo Liceo" son dos filas
-- del mismo club_id, así el historial de partidos (que apunta a teams) no se
-- rompe cuando cambia el patrocinador.
CREATE TABLE IF NOT EXISTS club_names (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id         UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  commercial_name TEXT NOT NULL,
  sponsor_id      UUID REFERENCES sponsors(id),
  valid_from      DATE NOT NULL,           -- inicio de la temporada en que aplica
  valid_to        DATE,                    -- NULL = vigente
  UNIQUE (club_id, commercial_name, valid_from)
);

-- ── Mapeo determinista ID-de-fuente → entidad ──────────────────────────
-- Reemplazo estructurado de teams.source_ref / teams.alt_source_refs. Una fila
-- por (fuente, ref). FK "polimórfica" con dos columnas + CHECK para conservar
-- integridad referencial real (exactamente una entidad por fila). En Fase 0 se
-- puebla apuntando a teams; coexiste con source_ref/alt_source_refs (no se
-- borran hasta migrar el consumo).
CREATE TABLE IF NOT EXISTS source_entity_map (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id   UUID NOT NULL REFERENCES data_sources(id),
  source_ref  TEXT NOT NULL,               -- 'fep_club_71', 'wse_team_...'
  club_id     UUID REFERENCES clubs(id) ON DELETE CASCADE,
  team_id     UUID REFERENCES teams(id) ON DELETE CASCADE,
  confidence  NUMERIC(4,3) NOT NULL DEFAULT 1.000,
  status      TEXT NOT NULL DEFAULT 'confirmed',   -- confirmed | pending
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (num_nonnulls(club_id, team_id) = 1),      -- exactamente una entidad
  UNIQUE (source_id, source_ref)
);
CREATE INDEX IF NOT EXISTS idx_source_entity_map_club ON source_entity_map (club_id);
CREATE INDEX IF NOT EXISTS idx_source_entity_map_team ON source_entity_map (team_id);

-- ── Enlace en teams (NULLABLE en Fase 0) + nivel de filial explícito ─────────
-- club_id se rellena en el backfill (Fase 0.2). squad_level saca el "B"/"C" del
-- nombre a un campo propio (1 = primer equipo). La UNIQUE de secciones
-- (club_id, gender, age_category, squad_level) se impone MÁS TARDE, tras la
-- limpieza/fusión: con backfill 1:1 y datos sucios reventaría ahora.
ALTER TABLE teams ADD COLUMN IF NOT EXISTS club_id     UUID REFERENCES clubs(id);
ALTER TABLE teams ADD COLUMN IF NOT EXISTS squad_level SMALLINT NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_teams_club_id ON teams (club_id);

COMMENT ON TABLE clubs IS 'Identidad estable del club (Fase 0 ER). teams cuelga de aquí vía club_id.';
COMMENT ON TABLE source_entity_map IS 'ID de fuente → entidad (determinista). Reemplazo estructurado de teams.source_ref/alt_source_refs.';
COMMENT ON COLUMN teams.club_id IS 'Club canónico. NULLABLE en Fase 0; lo rellena el backfill 0.2 (1 club por team).';
COMMENT ON COLUMN teams.squad_level IS 'Nivel de filial: 1=primer equipo (A), 2=B, 3=C...';

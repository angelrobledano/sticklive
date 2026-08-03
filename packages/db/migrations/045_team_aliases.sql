-- 045_team_aliases.sql — Fase 1 del Entity Resolution (embudo determinista)
--
-- ESTRICTAMENTE ADITIVA. Crea la caché de alias textuales (escalón 2 del
-- embudo): nombre normalizado → team. Nada existente cambia; el resolver la usa
-- como paso EXACTO entre el slug y el fuzzy (ver ref-resolver.ts). El fuzzy con
-- bloqueo, la cola HITL y la auto-confirmación son fases 2-3.
--
-- Ver docs/ARQUITECTURA_ENTITY_RESOLUTION.md §3.2.

CREATE TABLE IF NOT EXISTS team_aliases (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  raw_text    TEXT NOT NULL,               -- "COINASA LICEO B" tal cual vino
  normalized  TEXT NOT NULL,               -- "liceo" tras normalizeTeamName()
  source_id   UUID REFERENCES data_sources(id),
  confidence  NUMERIC(4,3) NOT NULL DEFAULT 1.000,
  status      TEXT NOT NULL DEFAULT 'confirmed', -- confirmed | pending | rejected
  created_by  TEXT NOT NULL,               -- 'deterministic' | 'fuzzy' | 'llm' | 'human:<user>'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Un alias normalizado por fuente. NULLs distintos en Postgres: aliases sin
  -- fuente (source_id NULL) no colisionan entre sí, lo cual es aceptable aquí.
  UNIQUE (normalized, source_id)
);

-- Búsqueda difusa a escala sin O(n²) (fase 2): índice GIN de trigramas.
-- pg_trgm ya está activo desde la migración 001.
CREATE INDEX IF NOT EXISTS idx_team_aliases_trgm
  ON team_aliases USING gin (normalized gin_trgm_ops);

-- Lookup exacto del escalón 2 (por normalized, filtrando rechazados).
CREATE INDEX IF NOT EXISTS idx_team_aliases_normalized
  ON team_aliases (normalized);

COMMENT ON TABLE team_aliases IS 'Caché de nombres normalizados → team (escalón 2 del embudo ER). Se alimenta de forma determinista (nombre del team) y, en fases 2-3, del fuzzy/HITL.';

-- 046_resolution_queue.sql — Fase 2 del Entity Resolution (cola HITL, escalón 4)
--
-- ESTRICTAMENTE ADITIVA. Cola de staging: lo que NO se resolvió con confianza
-- por los escalones deterministas (1-2) ni por slug. En vez de auto-confirmar
-- a ciegas (el viejo fuzzy a 0.4, origen del duplicado del Liceo), lo dudoso se
-- APARCA aquí con sus candidatos pre-rankeados para revisión humana (Fase 2b).
--
-- Regla de oro (arch §4): ante la duda, no se crea ni se fusiona; se aparca.
-- Un duplicado automático cuesta un merge manual; un ítem en cola, un clic.
--
-- Ver docs/ARQUITECTURA_ENTITY_RESOLUTION.md §3.2 y §4.

CREATE TABLE IF NOT EXISTS resolution_queue (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_text         TEXT NOT NULL,               -- nombre entrante tal cual
  normalized       TEXT NOT NULL,               -- normalizeTeamName(raw_text)
  source_id        UUID NOT NULL REFERENCES data_sources(id),
  source_ref       TEXT,                        -- ref de fuente si la había
  context          JSONB NOT NULL DEFAULT '{}', -- {sportId, competition, season, opponent...}
  candidates       JSONB NOT NULL DEFAULT '[]', -- [{teamId, name, score}] top-N pre-rankeados
  occurrences      INT  NOT NULL DEFAULT 1,     -- nº de veces vista → prioriza el panel
  status           TEXT NOT NULL DEFAULT 'pending', -- pending | resolved | rejected
  resolved_team_id UUID REFERENCES teams(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Una entrada por nombre desconocido y fuente, no una por partido: el panel
  -- resuelve una vez y se desatascan todas las filas que esperaban por él.
  UNIQUE (normalized, source_id)
);

-- El panel se ordena por impacto (occurrences DESC) entre los pendientes.
CREATE INDEX IF NOT EXISTS idx_resolution_queue_pending
  ON resolution_queue (status, occurrences DESC);

COMMENT ON TABLE resolution_queue IS 'Cola HITL del embudo ER (escalón 4). Lo no resuelto con confianza se aparca aquí con candidatos; el panel (Fase 2b) lo resuelve y realimenta team_aliases.';

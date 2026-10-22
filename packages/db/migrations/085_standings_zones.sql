-- ============================================================
-- 085 — Zonas de clasificación como datos (B2)
--
-- Ascenso, descenso, play-off, play-out, fase final… declarados por
-- TEMPORADA (y opcionalmente fase y grupo), con su fuente normativa
-- obligatoria. OKMob lo resuelve con reglas por regex sobre el nombre de la
-- competición aplicadas en cliente: un cambio de patrocinador las rompe sin
-- error. Aquí la clave es season_id y la zona se aplica en el servidor.
-- Aditiva.
-- ============================================================

CREATE TABLE IF NOT EXISTS standings_zones (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id   UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  phase_id    UUID REFERENCES phases(id) ON DELETE CASCADE,
  group_name  TEXT,
  kind        TEXT NOT NULL CHECK (kind IN ('champion','promotion','promotion_playoff','final_phase','placement','playout','relegation')),
  pos_from    INT  NOT NULL CHECK (pos_from >= 1),
  pos_to      INT  NOT NULL,
  target      TEXT,
  source_note TEXT NOT NULL CHECK (length(trim(source_note)) > 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (pos_to >= pos_from)
);
CREATE INDEX IF NOT EXISTS idx_standings_zones_season ON standings_zones (season_id);

COMMENT ON TABLE standings_zones IS
  'B2: zonas de clasificación por temporada/fase/grupo con fuente normativa. Se aplican en GET /seasons/:id/standings.';

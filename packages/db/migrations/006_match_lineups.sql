-- ============================================================
-- Migración 006: Alineaciones por partido
-- Fuente: ficha resumen rfep_gr_{idp}_1.php (tablas competiciones_tabla_basic)
-- Los jugadores se guardan desnormalizados (nombre + dorsal) porque la
-- fuente no expone un roster maestro fiable; player_id queda opcional
-- para vincular con players cuando exista.
-- ============================================================

CREATE TABLE IF NOT EXISTS match_lineups (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id        UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  team_id         UUID REFERENCES teams(id),
  is_home         BOOLEAN NOT NULL,
  jersey_number   INTEGER,
  player_name     TEXT NOT NULL,
  player_id       UUID REFERENCES players(id),
  is_goalkeeper   BOOLEAN NOT NULL DEFAULT FALSE,
  is_starter      BOOLEAN NOT NULL DEFAULT FALSE,
  is_captain      BOOLEAN NOT NULL DEFAULT FALSE,
  goals           INTEGER NOT NULL DEFAULT 0,
  source_ref      TEXT,
  scraped_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (match_id, is_home, player_name)
);

CREATE INDEX IF NOT EXISTS idx_match_lineups_match ON match_lineups(match_id);

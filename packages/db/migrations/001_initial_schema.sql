-- ============================================================
-- PLATAFORMA DE RESULTADOS DEPORTIVOS
-- Migración 001: Esquema inicial
-- ============================================================

-- Extensiones
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- Para búsqueda de texto

-- ============================================================
-- TRAZABILIDAD: fuentes de datos
-- ============================================================
CREATE TABLE data_sources (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,               -- "FEP Hockey Patines"
  base_url      TEXT NOT NULL,               -- "https://www.hockeypatines.fep.es"
  scraper_key   TEXT NOT NULL UNIQUE,        -- "fep_hockey" (clave interna del scraper)
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- DEPORTES
-- ============================================================
CREATE TABLE sports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL UNIQUE,        -- "Hockey sobre patines"
  slug          TEXT NOT NULL UNIQUE,        -- "hockey-patines"
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- COMPETICIONES
-- ============================================================
CREATE TABLE competitions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sport_id      UUID NOT NULL REFERENCES sports(id),
  name          TEXT NOT NULL,               -- "OK Liga"
  short_name    TEXT,                        -- "OKL"
  slug          TEXT NOT NULL,               -- "ok-liga"
  gender        TEXT CHECK (gender IN ('male', 'female', 'mixed', 'unknown')),
  category      TEXT,                        -- "senior", "junior", etc.
  country       TEXT NOT NULL DEFAULT 'ES',
  -- Trazabilidad
  source_id     UUID REFERENCES data_sources(id),
  source_ref    TEXT,                        -- ID interno en la fuente
  source_url    TEXT,
  scraped_at    TIMESTAMPTZ,
  -- Timestamps
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(sport_id, slug)
);

-- ============================================================
-- TEMPORADAS
-- ============================================================
CREATE TABLE seasons (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id  UUID NOT NULL REFERENCES competitions(id),
  name            TEXT NOT NULL,             -- "2025/26"
  slug            TEXT NOT NULL,             -- "2025-26"
  start_date      DATE,
  end_date        DATE,
  is_current      BOOLEAN NOT NULL DEFAULT FALSE,
  -- Trazabilidad
  source_id       UUID REFERENCES data_sources(id),
  source_ref      TEXT,
  source_url      TEXT,
  scraped_at      TIMESTAMPTZ,
  -- Timestamps
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(competition_id, slug)
);

-- Solo una temporada activa por competición
CREATE UNIQUE INDEX idx_seasons_one_current
  ON seasons(competition_id)
  WHERE is_current = TRUE;

-- ============================================================
-- EQUIPOS
-- ============================================================
CREATE TABLE teams (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sport_id      UUID NOT NULL REFERENCES sports(id),
  name          TEXT NOT NULL,
  short_name    TEXT,
  slug          TEXT NOT NULL,
  city          TEXT,
  country       TEXT NOT NULL DEFAULT 'ES',
  logo_url      TEXT,
  website_url   TEXT,
  -- Trazabilidad
  source_id     UUID REFERENCES data_sources(id),
  source_ref    TEXT,
  source_url    TEXT,
  scraped_at    TIMESTAMPTZ,
  -- Timestamps
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(sport_id, slug)
);

-- Tabla de participación: equipo en temporada
-- (un mismo equipo puede estar en varias competiciones/temporadas)
CREATE TABLE season_teams (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id     UUID NOT NULL REFERENCES seasons(id),
  team_id       UUID NOT NULL REFERENCES teams(id),
  group_name    TEXT,                        -- "Grupo A", "Norte", etc.
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(season_id, team_id)
);

-- ============================================================
-- JUGADORES
-- ============================================================
CREATE TABLE players (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sport_id      UUID NOT NULL REFERENCES sports(id),
  first_name    TEXT NOT NULL,
  last_name     TEXT NOT NULL,
  slug          TEXT NOT NULL,
  birth_date    DATE,
  nationality   TEXT,
  position      TEXT,                        -- "portero", "defensa", etc.
  -- Trazabilidad
  source_id     UUID REFERENCES data_sources(id),
  source_ref    TEXT,
  source_url    TEXT,
  scraped_at    TIMESTAMPTZ,
  -- Timestamps
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(sport_id, slug)
);

-- Plantilla: jugador en equipo/temporada
CREATE TABLE team_players (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id     UUID NOT NULL REFERENCES seasons(id),
  team_id       UUID NOT NULL REFERENCES teams(id),
  player_id     UUID NOT NULL REFERENCES players(id),
  jersey_number INT,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(season_id, team_id, player_id)
);

-- ============================================================
-- JORNADAS
-- ============================================================
CREATE TABLE rounds (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id       UUID NOT NULL REFERENCES seasons(id),
  number          INT NOT NULL,
  name            TEXT,                      -- "Jornada 1", "Cuartos", etc.
  round_type      TEXT NOT NULL DEFAULT 'regular'
                  CHECK (round_type IN ('regular', 'playoff', 'cup', 'friendly')),
  start_date      DATE,
  end_date        DATE,
  -- Trazabilidad
  source_id       UUID REFERENCES data_sources(id),
  source_ref      TEXT,
  scraped_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(season_id, number, round_type)
);

-- ============================================================
-- PARTIDOS
-- ============================================================
CREATE TABLE matches (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id       UUID NOT NULL REFERENCES seasons(id),
  round_id        UUID REFERENCES rounds(id),
  home_team_id    UUID NOT NULL REFERENCES teams(id),
  away_team_id    UUID NOT NULL REFERENCES teams(id),
  -- Resultado
  home_score      INT,
  away_score      INT,
  status          TEXT NOT NULL DEFAULT 'scheduled'
                  CHECK (status IN ('scheduled', 'live', 'finished', 'postponed', 'cancelled')),
  -- Tiempos
  scheduled_at    TIMESTAMPTZ,
  started_at      TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ,
  -- Ubicación
  venue_name      TEXT,
  venue_city      TEXT,
  -- Metadatos
  is_neutral      BOOLEAN NOT NULL DEFAULT FALSE,
  attendance      INT,
  referee         TEXT,
  notes           TEXT,
  -- Trazabilidad
  source_id       UUID REFERENCES data_sources(id),
  source_ref      TEXT,
  source_url      TEXT,
  scraped_at      TIMESTAMPTZ,
  -- Timestamps
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_different_teams CHECK (home_team_id <> away_team_id)
);

-- ============================================================
-- EVENTOS DE PARTIDO
-- ============================================================
CREATE TABLE match_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id        UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  team_id         UUID REFERENCES teams(id),
  player_id       UUID REFERENCES players(id),
  event_type      TEXT NOT NULL
                  CHECK (event_type IN ('goal', 'penalty', 'blue_card', 'red_card', 'timeout', 'period_end')),
  minute          INT,
  period          INT,
  detail          TEXT,                      -- Info adicional libre
  -- Trazabilidad
  source_id       UUID REFERENCES data_sources(id),
  source_ref      TEXT,
  scraped_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- CLASIFICACIONES
-- ============================================================
CREATE TABLE standings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id       UUID NOT NULL REFERENCES seasons(id),
  team_id         UUID NOT NULL REFERENCES teams(id),
  group_name      TEXT,
  -- Posición
  position        INT,
  -- Estadísticas
  played          INT NOT NULL DEFAULT 0,
  won             INT NOT NULL DEFAULT 0,
  drawn           INT NOT NULL DEFAULT 0,
  lost            INT NOT NULL DEFAULT 0,
  goals_for       INT NOT NULL DEFAULT 0,
  goals_against   INT NOT NULL DEFAULT 0,
  goal_diff       INT GENERATED ALWAYS AS (goals_for - goals_against) STORED,
  points          INT NOT NULL DEFAULT 0,
  form            TEXT[],                    -- ["W", "W", "D", "L", "W"] últimos 5
  -- Trazabilidad
  source_id       UUID REFERENCES data_sources(id),
  scraped_at      TIMESTAMPTZ,
  -- Timestamps
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(season_id, team_id, group_name)
);

-- ============================================================
-- LOG DE SCRAPING (para auditoría y debugging)
-- ============================================================
CREATE TABLE scrape_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id       UUID REFERENCES data_sources(id),
  scraper_key     TEXT NOT NULL,
  entity_type     TEXT NOT NULL,             -- "competition", "match", etc.
  entity_ref      TEXT,                      -- ID en la fuente
  status          TEXT NOT NULL CHECK (status IN ('success', 'error', 'skipped', 'partial')),
  records_found   INT,
  records_upserted INT,
  error_message   TEXT,
  duration_ms     INT,
  scraped_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- ÍNDICES DE RENDIMIENTO
-- ============================================================
CREATE INDEX idx_matches_season       ON matches(season_id);
CREATE INDEX idx_matches_status       ON matches(status);
CREATE INDEX idx_matches_scheduled    ON matches(scheduled_at);
CREATE INDEX idx_matches_home_team    ON matches(home_team_id);
CREATE INDEX idx_matches_away_team    ON matches(away_team_id);
CREATE INDEX idx_standings_season     ON standings(season_id);
CREATE INDEX idx_rounds_season        ON rounds(season_id);
CREATE INDEX idx_match_events_match   ON match_events(match_id);
CREATE INDEX idx_team_players_season  ON team_players(season_id, team_id);
CREATE INDEX idx_scrape_logs_key      ON scrape_logs(scraper_key, scraped_at DESC);

-- Búsqueda de texto en equipos y jugadores
CREATE INDEX idx_teams_name_trgm      ON teams USING gin(name gin_trgm_ops);
CREATE INDEX idx_players_name_trgm    ON players USING gin((first_name || ' ' || last_name) gin_trgm_ops);

-- ============================================================
-- FUNCIÓN: auto-actualizar updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_competitions_updated_at BEFORE UPDATE ON competitions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_seasons_updated_at      BEFORE UPDATE ON seasons      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_teams_updated_at        BEFORE UPDATE ON teams        FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_players_updated_at      BEFORE UPDATE ON players      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_matches_updated_at      BEFORE UPDATE ON matches      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_standings_updated_at    BEFORE UPDATE ON standings    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_rounds_updated_at       BEFORE UPDATE ON rounds       FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- DATOS INICIALES
-- ============================================================
INSERT INTO data_sources (name, base_url, scraper_key, notes) VALUES
  ('RFEP - Hockey Patines', 'https://www.hockeypatines.fep.es', 'fep_hockey',
   'Portal oficial de la Real Federación Española de Patinaje — sección hockey. Usa sidgad.com como plataforma.');

INSERT INTO sports (name, slug) VALUES
  ('Hockey sobre patines', 'hockey-patines');

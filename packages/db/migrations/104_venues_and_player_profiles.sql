-- ============================================================
-- 104 — Pabellones y fichas de jugador desde la API de sidgad (2/11/2026)
--
-- La RFEP nos dio acceso a api.sidgad.com. Por ahora SOLO se usa para:
--   · `pistas`: catálogo de pabellones con dirección y código postal (el
--     marcado de eventos de Google exige dirección).
--   · `profile`: ficha de cada jugador RFEP (foto exacta, nacionalidad y
--     fecha de nacimiento). La fecha de nacimiento se guarda pero NO se publica.
-- Aditiva e idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS venues (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_ref   TEXT NOT NULL UNIQUE,          -- sidgad_rfep_pista_57
  name         TEXT NOT NULL,                 -- PALAU D'ESPORTS DE REUS
  name_key     TEXT NOT NULL,                 -- clave de cruce con matches.venue_name
  street       TEXT,
  postal_code  TEXT,
  capacity     INTEGER,
  surface      TEXT,
  scraped_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS venues_name_key_idx ON venues (name_key);

-- Cuándo se consultó por última vez la ficha del jugador en la API (para ir
-- por tandas y no repetir).
ALTER TABLE players ADD COLUMN IF NOT EXISTS profile_checked_at TIMESTAMPTZ;

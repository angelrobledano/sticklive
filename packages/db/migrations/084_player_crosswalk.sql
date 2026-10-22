-- ============================================================
-- 084 — Crosswalk de personas entre portales (B1)
--
-- Tras la 081 cada portal tiene su propia ref de jugador y ya no se fusionan
-- personas por coincidencia de número. Pero la MISMA persona sigue partida en
-- tantas fichas como portales (Martí Serra Molist: fep_player_4095,
-- fecapa_player_14782, wse_player_3801). Esto modela lo que OKMob resuelve con
-- su `person-xwalk` (persons + forbid + moved), en relacional:
--
--   · player_source_refs: N refs por persona (una ref, una persona),
--   · player_link_forbidden: pares de refs declarados como personas distintas,
--   · player_link_candidates: propuestas para revisión humana (nunca se
--     enlaza automáticamente),
--   · la ficha absorbida deja redirección en entity_redirects (073).
--
-- Aditiva. `backfill_player_source_refs()` es re-ejecutable.
-- ============================================================

CREATE TABLE IF NOT EXISTS player_source_refs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id  UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  source_ref TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL DEFAULT 'scraper',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_player_source_refs_player ON player_source_refs (player_id);

CREATE TABLE IF NOT EXISTS player_link_forbidden (
  ref_a      TEXT NOT NULL,
  ref_b      TEXT NOT NULL,
  reason     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (ref_a, ref_b),
  CHECK (ref_a < ref_b)
);

CREATE TABLE IF NOT EXISTS player_link_candidates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_a    UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  player_b    UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  score       NUMERIC(4,3) NOT NULL,
  evidence    JSONB NOT NULL DEFAULT '{}',
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  CHECK (player_a < player_b),
  UNIQUE (player_a, player_b)
);
CREATE INDEX IF NOT EXISTS idx_player_link_candidates_status ON player_link_candidates (status, score DESC);

CREATE OR REPLACE FUNCTION backfill_player_source_refs() RETURNS INT
LANGUAGE sql AS $$
  WITH ins AS (
    INSERT INTO player_source_refs (player_id, source_ref, created_by)
    SELECT id, source_ref, 'backfill-084' FROM players WHERE source_ref IS NOT NULL
    ON CONFLICT (source_ref) DO NOTHING
    RETURNING 1
  ) SELECT count(*)::int FROM ins
$$;

SELECT backfill_player_source_refs();

-- Clave de nombre para proponer candidatos: minúsculas, sin acentos ni signos.
CREATE OR REPLACE FUNCTION player_name_key(p_first TEXT, p_last TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT trim(regexp_replace(
    translate(lower(coalesce(p_last, '') || ' ' || coalesce(p_first, '')),
              'áàäâãéèëêíìïîóòöôõúùüûñçl·', 'aaaaaeeeeiiiiooooouuuuncl.'),
    '[^a-z0-9]+', ' ', 'g'))
$$;

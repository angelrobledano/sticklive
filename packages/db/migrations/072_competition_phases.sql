-- ============================================================
-- 072 — Fases de competición
--
--   Competition → Season → Phase → (Group) → Round → Match
--
-- Hasta ahora una competición tenía UN "formato" declarado a mano
-- (competition_sources.external_ids.format = league | bracket | final_four) y
-- las rondas sólo distinguían regular/playoff. Una competición real es una
-- SECUENCIA de fases (liga regular → playoff; grupos → final four; solo final
-- four…) y la fuente ya publica esa estructura de forma explícita (bloques
-- `content_fase_X` con título y cabeceras "2 CUARTOS", "SEMIFINALES"…), que se
-- perdía al cargar y la API/web tenían que reinferir con heurísticas.
--
-- Esta migración es ADITIVA y no borra datos:
--   · `phases`: fase de una temporada (kind league|groups|knockout, colocación,
--     orden, nombre y trazabilidad: de dónde salió — `resolved_by`).
--   · `rounds.phase_id` + `rounds.stage` (fase eliminatoria canónica).
--   · `matches.phase_id` (pertenencia aunque el partido no tenga ronda) y
--     `matches.series_game` (nº de partido dentro de la eliminatoria).
--   · La identidad de ronda pasa a (temporada, FASE, número, tipo): dos fases
--     pueden tener su "ronda 1". Para las filas existentes (phase_id NULL) la
--     unicidad es la misma que antes (NULLS NOT DISTINCT).
--   · Backfill: cada temporada existente recibe fases `legacy` deducidas de lo
--     que ya hay (round_type y formato declarado), sin reinterpretar nada. La
--     fase eliminatoria (`stage`) solo se fija en rondas legadas cuyo nombre es
--     inequívoco Y cuyo número de cruces es compatible; si no (p. ej. la ronda
--     100 "Playoff por el título", o una "FINAL" que en realidad contiene todo
--     el cuadro por un bug antiguo del scraper), queda NULL. El siguiente scrape
--     de la fuente adopta esas fases y las completa con la estructura explícita.
--
-- Idempotente: re-aplicarla no duplica nada (IF NOT EXISTS + guardas).
-- ============================================================

CREATE TABLE IF NOT EXISTS phases (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id     UUID NOT NULL REFERENCES seasons(id),
  ordinal       INT  NOT NULL CHECK (ordinal > 0),
  kind          TEXT NOT NULL CHECK (kind IN ('league', 'groups', 'knockout')),
  is_placement  BOOLEAN NOT NULL DEFAULT FALSE,
  name          TEXT,
  resolved_by   TEXT NOT NULL DEFAULT 'legacy'
                CHECK (resolved_by IN ('source_rounds', 'source_title', 'declared',
                                       'structural_rule', 'fallback', 'legacy')),
  source_id     UUID REFERENCES data_sources(id),
  source_ref    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE phases IS
  'Fase de una temporada (liga regular, grupos, playoff, final four, colocación…). El formato de la competición es la secuencia de sus fases.';
COMMENT ON COLUMN phases.resolved_by IS
  'Evidencia que decidió kind: source_rounds|source_title (fuente) > declared (competition_sources) > structural_rule > fallback; legacy = backfill 072.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_phases_season_source_ref
  ON phases(season_id, source_ref) WHERE source_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_phases_season ON phases(season_id, ordinal);

DROP TRIGGER IF EXISTS trg_phases_updated_at ON phases;
CREATE TRIGGER trg_phases_updated_at BEFORE UPDATE ON phases
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Rondas: fase + fase eliminatoria canónica ─────────────────────────────
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS phase_id UUID REFERENCES phases(id);
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS stage TEXT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rounds_stage_check') THEN
    ALTER TABLE rounds ADD CONSTRAINT rounds_stage_check CHECK (
      stage IS NULL OR stage IN ('round_of_16', 'quarters', 'semis', 'final', 'third_place', 'placement')
    );
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_rounds_phase ON rounds(phase_id);

-- Identidad (temporada, fase, número, tipo). NULLS NOT DISTINCT: para las rondas
-- sin fase se mantiene exactamente la unicidad anterior (temporada, número, tipo).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rounds_season_id_number_round_type_key') THEN
    ALTER TABLE rounds DROP CONSTRAINT rounds_season_id_number_round_type_key;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_rounds_season_phase_number_type') THEN
    ALTER TABLE rounds ADD CONSTRAINT uq_rounds_season_phase_number_type
      UNIQUE NULLS NOT DISTINCT (season_id, phase_id, number, round_type);
  END IF;
END $$;

-- ── Partidos: fase + nº de partido de la serie ────────────────────────────
ALTER TABLE matches ADD COLUMN IF NOT EXISTS phase_id UUID REFERENCES phases(id);
ALTER TABLE matches ADD COLUMN IF NOT EXISTS series_game INT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matches_series_game_check') THEN
    ALTER TABLE matches ADD CONSTRAINT matches_series_game_check CHECK (series_game IS NULL OR series_game > 0);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_matches_phase ON matches(phase_id) WHERE phase_id IS NOT NULL;

COMMENT ON COLUMN matches.series_game IS
  'Nº de partido dentro de la eliminatoria según la fuente ("2 CUARTOS" → 2; ida=1, vuelta=2). NULL = partido único o desconocido.';

-- ── Backfill legado ───────────────────────────────────────────────────────
-- Función (y no un bloque suelto) para poder re-ejecutarla y testearla contra
-- datos sembrados: los tests de integración migran una base vacía.
CREATE OR REPLACE FUNCTION backfill_legacy_phases() RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE
  s           RECORD;
  p_league    UUID;
  p_knockout  UUID;
  created     INT := 0;
BEGIN
  FOR s IN
    SELECT se.id,
           EXISTS (SELECT 1 FROM rounds r WHERE r.season_id = se.id AND r.phase_id IS NULL
                     AND r.round_type IN ('regular', 'friendly'))                       AS has_regular,
           EXISTS (SELECT 1 FROM rounds r WHERE r.season_id = se.id AND r.phase_id IS NULL
                     AND r.round_type IN ('playoff', 'cup'))                            AS has_knockout,
           EXISTS (SELECT 1 FROM matches m WHERE m.season_id = se.id AND m.round_id IS NULL
                     AND m.phase_id IS NULL)                                            AS has_orphans,
           COALESCE((SELECT cs.external_ids->>'format' FROM competition_sources cs
                      WHERE cs.competition_id = se.competition_id LIMIT 1)
                    IN ('bracket', 'final_four'), FALSE)                                AS declared_knockout,
           EXISTS (SELECT 1 FROM matches m LEFT JOIN rounds r ON r.id = m.round_id
                    WHERE m.season_id = se.id AND m.group_name IS NOT NULL
                      AND COALESCE(r.round_type, 'regular') IN ('regular', 'friendly')) AS has_groups
      FROM seasons se
     WHERE NOT EXISTS (SELECT 1 FROM phases p WHERE p.season_id = se.id)
  LOOP
    p_league := NULL;
    p_knockout := NULL;

    IF s.has_regular OR (s.has_orphans AND NOT s.declared_knockout) THEN
      INSERT INTO phases (season_id, ordinal, kind, resolved_by)
      VALUES (s.id, 1, CASE WHEN s.has_groups THEN 'groups' ELSE 'league' END, 'legacy')
      RETURNING id INTO p_league;
      created := created + 1;
    END IF;

    IF s.has_knockout OR (s.has_orphans AND s.declared_knockout) THEN
      INSERT INTO phases (season_id, ordinal, kind, resolved_by)
      VALUES (s.id, CASE WHEN p_league IS NULL THEN 1 ELSE 2 END, 'knockout', 'legacy')
      RETURNING id INTO p_knockout;
      created := created + 1;
    END IF;

    UPDATE rounds SET phase_id = p_league
     WHERE season_id = s.id AND phase_id IS NULL AND round_type IN ('regular', 'friendly')
       AND p_league IS NOT NULL;
    UPDATE rounds SET phase_id = p_knockout
     WHERE season_id = s.id AND phase_id IS NULL AND round_type IN ('playoff', 'cup')
       AND p_knockout IS NOT NULL;

    UPDATE matches m SET phase_id = r.phase_id
      FROM rounds r
     WHERE r.id = m.round_id AND m.season_id = s.id AND m.phase_id IS NULL;
    UPDATE matches SET phase_id = CASE WHEN s.declared_knockout THEN p_knockout ELSE p_league END
     WHERE season_id = s.id AND round_id IS NULL AND phase_id IS NULL;
  END LOOP;

  -- Fase eliminatoria de las rondas legadas: SOLO nombre inequívoco + nº de
  -- cruces compatible (una "FINAL" con 7 partidos de 7 cruces no es una final).
  WITH legacy AS (
    SELECT r.id,
           upper(translate(coalesce(r.name, ''), 'ÁÉÍÓÚáéíóúºª', 'AEIOUaeiouOA')) AS n,
           (SELECT count(DISTINCT LEAST(m.home_team_id::text, m.away_team_id::text) || '|' ||
                                  GREATEST(m.home_team_id::text, m.away_team_id::text))
              FROM matches m WHERE m.round_id = r.id) AS ties
      FROM rounds r
      JOIN phases p ON p.id = r.phase_id AND p.kind = 'knockout' AND p.resolved_by = 'legacy'
     WHERE r.stage IS NULL
  ), staged AS (
    SELECT id, ties,
           CASE
             WHEN n ~ 'OCTAVOS|ROUND OF 16|1/8'                             THEN 'round_of_16'
             WHEN n ~ 'CUARTOS|QUARTER'                                     THEN 'quarters'
             WHEN n ~ 'SEMI'                                                THEN 'semis'
             WHEN n ~ '3O? Y 4|TERCER|BRONZE|BRONCE|SMALL FINAL'            THEN 'third_place'
             WHEN n ~ 'PUESTOS|PLACE|POSITION'                              THEN 'placement'
             WHEN n ~ '(^|[^A-Z])FINAL([^A-Z]|$)|GOLD MEDAL'                THEN 'final'
           END AS stage
      FROM legacy
  )
  UPDATE rounds r SET stage = st.stage
    FROM staged st
   WHERE r.id = st.id AND st.stage IS NOT NULL
     AND st.ties <= CASE st.stage
                      WHEN 'final' THEN 1 WHEN 'third_place' THEN 1
                      WHEN 'semis' THEN 2 WHEN 'quarters' THEN 4
                      WHEN 'round_of_16' THEN 8 ELSE st.ties END;

  RETURN created;
END $$;

-- Ejecutar el backfill sin tocar `matches.updated_at` (lo usan el ciclo de
-- fichas y la caché: el cambio de pertenencia no es un cambio del partido).
ALTER TABLE matches DISABLE TRIGGER trg_matches_updated_at;
SELECT backfill_legacy_phases();
ALTER TABLE matches ENABLE TRIGGER trg_matches_updated_at;

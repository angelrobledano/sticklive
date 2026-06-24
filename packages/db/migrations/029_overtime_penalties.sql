-- ============================================================
-- Migración 029: prórroga y tanda de penaltis
--
-- Hasta ahora un partido era home_score/away_score + status de 5 valores.
-- En eliminatorias un partido puede acabar empatado y resolverse en prórroga
-- o penaltis, y hoy se pierde el ganador (un 2-2 por penaltis no muestra quién
-- ganó, y la lógica de playoff lo atribuye mal).
--
-- home_score/away_score se mantienen como MARCADOR MOSTRADO (incluye prórroga).
-- Se añaden:
--   · marcador al final del tiempo reglamentario (para "3-3 (4-3 prórroga)")
--   · marcador de la tanda de penaltis
--   · tipo de victoria y ganador explícito (fuente de verdad para el ganador)
-- Todo nullable: los partidos normales no rellenan nada y siguen igual.
-- ============================================================

ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS home_goals_reg  INT,
  ADD COLUMN IF NOT EXISTS away_goals_reg  INT,
  ADD COLUMN IF NOT EXISTS home_pen        INT,
  ADD COLUMN IF NOT EXISTS away_pen        INT,
  ADD COLUMN IF NOT EXISTS win_type        TEXT
    CHECK (win_type IS NULL OR win_type IN ('regular', 'overtime', 'penalties')),
  ADD COLUMN IF NOT EXISTS winner_team_id  UUID REFERENCES teams(id);

-- Ampliar los estados en vivo: descanso, prórroga y tanda de penaltis.
ALTER TABLE matches DROP CONSTRAINT IF EXISTS matches_status_check;
ALTER TABLE matches ADD CONSTRAINT matches_status_check
  CHECK (status IN ('scheduled', 'live', 'halftime', 'overtime', 'penalty_shootout', 'finished', 'postponed', 'cancelled'));

COMMENT ON COLUMN matches.win_type IS 'Cómo se decidió: regular | overtime | penalties (NULL = sin resolver / no aplica).';
COMMENT ON COLUMN matches.winner_team_id IS 'Ganador explícito. Fuente de verdad para playoffs cuando el marcador queda empatado (penaltis).';

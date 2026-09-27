-- ============================================================
-- Migración 054: ref de club de una fuente → equipo, ACOTADO por competición
--
-- El feed de directo (rfep_mc_1.php) identifica los equipos por ref de CLUB
-- (`fep_club_XX`), que NO es un identificador de equipo: un mismo club puede
-- tener primer equipo y filial en competiciones distintas de la misma temporada
-- y con el mismo nombre (bug A/B del NOIA). Un mapeo global cruzaba las dos
-- secciones; acotado por competición es seguro (un club alinea un solo equipo
-- por competición).
--
-- Se APRENDE de los partidos ya enlazados por idp (el calendario y el feed
-- comparten idp) y de las adopciones buenas, y se usa para desempatar la
-- adopción del directo cuando varios partidos de la misma liga empiezan a la
-- misma hora.
--
-- Aditiva e idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS source_club_map (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id      UUID NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
  competition_id UUID NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  club_ref       TEXT NOT NULL,
  team_id        UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_id, competition_id, club_ref)
);

CREATE INDEX IF NOT EXISTS idx_source_club_map_team ON source_club_map (team_id);

COMMENT ON TABLE source_club_map IS
  'Ref de club de una fuente -> equipo, ACOTADO por competición (un club = un equipo por competición). Aprendido del directo; desempata partidos simultáneos.';

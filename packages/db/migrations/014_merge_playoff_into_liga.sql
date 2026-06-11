-- ============================================================
-- Migración 014: fusionar el playoff en la OK Liga como FASE
--
-- Modelo objetivo para el histórico multianual: una competición
-- "OK Liga Masculina" cuyas temporadas contienen liga regular y
-- playoff como fases (rounds.round_type), en vez de dos
-- competiciones separadas.
--
-- Pasos:
--   1. Ronda "Playoff por el título" (round_type='playoff', number=100)
--      en la temporada en curso de la liga.
--   2. Mover los partidos de la temporada del playoff a la de la liga,
--      asignándoles esa ronda. (match_events/match_lineups cuelgan del
--      partido, viajan solos.)
--   3. Fusionar team_players y limpiar season_teams/standings huérfanos.
--   4. Eliminar la temporada y competición del playoff.
--
-- Idempotente: si la competición playoff ya no existe, no hace nada.
-- ============================================================

DO $$
DECLARE
  liga_season uuid;
  po_season   uuid;
  po_comp     uuid;
  playoff_round uuid;
BEGIN
  SELECT c.id INTO po_comp FROM competitions c WHERE c.slug = 'ok-liga-masculina-playoff';
  IF po_comp IS NULL THEN
    RAISE NOTICE 'Playoff ya fusionado — nada que hacer';
    RETURN;
  END IF;

  SELECT s.id INTO liga_season
  FROM seasons s JOIN competitions c ON c.id = s.competition_id
  WHERE c.slug = 'ok-liga-masculina' AND s.is_current = TRUE;

  SELECT s.id INTO po_season FROM seasons s WHERE s.competition_id = po_comp AND s.is_current = TRUE;

  IF liga_season IS NULL OR po_season IS NULL THEN
    -- BD virgen (sin seed): no hay nada que fusionar. Los datos llegarán
    -- por dump/seed ya fusionados; esta migración solo aplicaba al entorno
    -- que tenía liga y playoff como competiciones separadas.
    RAISE NOTICE 'Sin temporadas que fusionar (liga=%, playoff=%) — saltando', liga_season, po_season;
    RETURN;
  END IF;

  -- 1. Ronda de fase playoff en la temporada de la liga
  SELECT id INTO playoff_round FROM rounds
  WHERE season_id = liga_season AND round_type = 'playoff' AND number = 100;
  IF playoff_round IS NULL THEN
    INSERT INTO rounds (season_id, number, name, round_type)
    VALUES (liga_season, 100, 'Playoff por el título', 'playoff')
    RETURNING id INTO playoff_round;
  END IF;

  -- 2. Mover partidos
  UPDATE matches SET season_id = liga_season, round_id = playoff_round
  WHERE season_id = po_season;

  -- 3. Fusionar pertenencias de jugadores y limpiar
  INSERT INTO team_players (season_id, team_id, player_id, jersey_number)
  SELECT liga_season, team_id, player_id, jersey_number
  FROM team_players WHERE season_id = po_season
  ON CONFLICT (season_id, team_id, player_id)
  DO UPDATE SET jersey_number = COALESCE(EXCLUDED.jersey_number, team_players.jersey_number);

  DELETE FROM team_players WHERE season_id = po_season;
  DELETE FROM season_teams  WHERE season_id = po_season;
  DELETE FROM standings     WHERE season_id = po_season;
  DELETE FROM rounds        WHERE season_id = po_season;

  -- 4. Eliminar temporada y competición del playoff
  DELETE FROM seasons      WHERE id = po_season;
  DELETE FROM competitions WHERE id = po_comp;

  RAISE NOTICE 'Playoff fusionado en la temporada % de OK Liga', liga_season;
END $$;

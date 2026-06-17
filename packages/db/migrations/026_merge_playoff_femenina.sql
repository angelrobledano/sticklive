-- ============================================================
-- Migración 026: fusionar el playoff femenino en la OK Liga Femenina
--
-- Igual que la 014 (masculino): la OK Liga Femenina pasa a tener la liga
-- regular (idc 3151) y el playoff (idc 3484) como FASES de una misma
-- temporada, en vez de dos competiciones separadas.
--
-- Mueve los partidos de la competición 'playoff-ok-liga-femenina' a la
-- temporada en curso de 'ok-liga-femenina', asignándoles una ronda de
-- fase playoff, y elimina la competición/temporada huérfana.
--
-- Idempotente: si la competición playoff ya no existe, no hace nada.
-- ============================================================

DO $$
DECLARE
  liga_season   uuid;
  po_season     uuid;
  po_comp       uuid;
  playoff_round uuid;
BEGIN
  SELECT id INTO po_comp FROM competitions WHERE slug = 'playoff-ok-liga-femenina';
  IF po_comp IS NULL THEN
    RAISE NOTICE 'Playoff femenino ya fusionado — nada que hacer';
    RETURN;
  END IF;

  SELECT s.id INTO liga_season
  FROM seasons s JOIN competitions c ON c.id = s.competition_id
  WHERE c.slug = 'ok-liga-femenina' AND s.is_current = TRUE;

  SELECT s.id INTO po_season
  FROM seasons s WHERE s.competition_id = po_comp AND s.is_current = TRUE;

  IF liga_season IS NULL OR po_season IS NULL THEN
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

  -- 2. Mover partidos (match_events/match_lineups cuelgan del partido, viajan solos)
  UPDATE matches SET season_id = liga_season, round_id = playoff_round
  WHERE season_id = po_season;

  -- 3. Fusionar pertenencias de jugadores y limpiar lo huérfano
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

  RAISE NOTICE 'Playoff femenino fusionado en la temporada % de OK Liga Femenina', liga_season;
END $$;

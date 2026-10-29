-- ============================================================
-- 097 — Fuera los pseudo-equipos de descanso («DESCANSO 1», «DESCANSO 2»)
--
-- sidgad mete un rival «DESCANSO» en la fila de bye de las ligas de número
-- impar. El alta de equipos solo filtraba «DESCANSO» a secas, así que las
-- variantes numeradas entraron como equipos (y como club «DESCANSO 1»).
-- El filtro ya reconoce el número (isByeTeamName). Aquí se borra lo creado:
-- sus «partidos» de bye, inscripciones, clasificaciones y el club huérfano.
-- Idempotente: si no hay equipos de descanso no hace nada.
-- ============================================================
DROP TABLE IF EXISTS pg_temp.bye_teams, pg_temp.bye_matches;
CREATE TEMP TABLE bye_teams AS
  SELECT id, club_id FROM teams WHERE name ~* '^\s*descanso(\s+[0-9]+)?\s*$';

CREATE TEMP TABLE bye_matches AS
  SELECT id FROM matches
   WHERE home_team_id IN (SELECT id FROM bye_teams)
      OR away_team_id IN (SELECT id FROM bye_teams);

DELETE FROM match_events  WHERE match_id IN (SELECT id FROM bye_matches) OR team_id IN (SELECT id FROM bye_teams);
DELETE FROM match_lineups WHERE match_id IN (SELECT id FROM bye_matches) OR team_id IN (SELECT id FROM bye_teams);
DELETE FROM matches       WHERE id IN (SELECT id FROM bye_matches);
UPDATE matches SET winner_team_id = NULL WHERE winner_team_id IN (SELECT id FROM bye_teams);

DELETE FROM standings    WHERE team_id IN (SELECT id FROM bye_teams);
DELETE FROM season_teams WHERE team_id IN (SELECT id FROM bye_teams);
DELETE FROM team_players WHERE team_id IN (SELECT id FROM bye_teams);
UPDATE resolution_queue SET resolved_team_id = NULL WHERE resolved_team_id IN (SELECT id FROM bye_teams);
DELETE FROM user_favorites WHERE kind = 'team' AND ref_id IN (SELECT id FROM bye_teams);
UPDATE push_subscriptions
   SET fav_teams = ARRAY(SELECT x FROM unnest(fav_teams) x WHERE x NOT IN (SELECT id FROM bye_teams))
 WHERE fav_teams && ARRAY(SELECT id FROM bye_teams);

DELETE FROM teams WHERE id IN (SELECT id FROM bye_teams);

-- Clubes que solo existían por ellos.
DELETE FROM clubs c
 WHERE c.id IN (SELECT club_id FROM bye_teams WHERE club_id IS NOT NULL)
   AND NOT EXISTS (SELECT 1 FROM teams t WHERE t.club_id = c.id);

-- Y si la fila de descanso quedó en la cola, también sobra.
DELETE FROM resolution_queue
 WHERE status = 'pending' AND raw_text ~* '^\s*descanso(\s+[0-9]+)?\s*$';

DROP TABLE bye_matches, bye_teams;

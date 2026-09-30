-- ============================================================
-- 059 — Coherencia del ganador con el marcador (#326).
--
-- Existía un registro semánticamente imposible: finished 4-4 con
-- winner_team_id informado y win_type='regular'. Mecanismo: el ETL deriva el
-- ganador por marcador cuando difieren (p. ej. 5-4 momentáneo del acta) y el
-- marcador se corrige después a empate SIN recalcular el ganador (el CASE de
-- derive-results conservaba el winner en el ELSE). La web puede mostrar un
-- "ganador" en un partido empatado.
--
-- Esta migración: (a) limpia los ganadores imposibles hoy, (b) añade un CHECK
-- que impide que vuelvan a existir.
--
-- Regla semántica: en hockey sobre patines un empate sólo tiene ganador vía
-- tanda de penaltis (win_type='penalties': marcador empatado, el ganador lo
-- pone el acta). En tiempo reglamentario o prórroga (muerte súbita) el ganador
-- implica marcadores distintos.
--
-- CONTRATO CON LOS ESCRITORES: el marcador lo escribe el feed (upsertMatch y
-- los UPDATE de respaldo del loader) en cada ciclo, y win_type/winner los
-- deriva el ETL DESPUÉS. Entre medias la fila puede ser incoherente
-- (marcador corregido a empate, winner viejo aún informado), así que esos
-- escritores invalidan el estado derivado en la misma sentencia cuando el
-- marcador resultante es un empate sin tanda. Sin esa cláusula, este CHECK
-- rechazaría la ingesta de una corrección legítima del acta.
-- ============================================================

-- (a) Data-fix: ganador informado donde no puede haberlo. Idempotente (0 filas
--     en una base recién migrada; en producción, las 1-2 filas del hallazgo).
UPDATE matches
   SET winner_team_id = NULL
 WHERE winner_team_id IS NOT NULL
   AND NOT (win_type = 'penalties' OR home_score IS DISTINCT FROM away_score);

-- (b) CHECK. `IS DISTINCT FROM` y no `<>`: con marcadores NULL (ambos o uno)
--     `<>` devuelve NULL y el resultado del CHECK sería confuso; con
--     DISTINCT FROM, dos NULL cuentan como "iguales" (sin ganador posible) y
--     un NULL + un valor cuentan como "distintos" (dato extraño del histórico
--     pero no incoherente en cuanto al ganador).
ALTER TABLE matches ADD CONSTRAINT matches_winner_score_coherence CHECK (
  winner_team_id IS NULL
  OR win_type = 'penalties'
  OR home_score IS DISTINCT FROM away_score
);

COMMENT ON CONSTRAINT matches_winner_score_coherence ON matches IS
  'Un empate no puede tener ganador salvo por tanda de penaltis (win_type=penalties). Los escritores del marcador invalidan win_type/winner si el marcador resultante es empate sin tanda (ver upsertMatch y derive-results, #326).';

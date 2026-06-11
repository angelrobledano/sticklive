-- ============================================================
-- Migración 011: deduplicar standings y arreglar la unicidad
-- Dos problemas combinados:
--  a) UNIQUE(season_id, team_id, group_name) no aplica con group_name
--     NULL (NULL <> NULL en SQL) — cada scrape insertaba fila nueva.
--  b) El scraper empezó a escribir group_name='CLASIFICACIÓN' donde
--     antes escribía NULL, dejando pares NULL/'CLASIFICACIÓN' por equipo.
-- Estrategia: una fila por (season, team) conservando la más reciente.
-- Nota: hoy ninguna competición indexada usa grupos reales (A/B). Si
-- llegan, este dedupe ya habrá pasado y el índice nuevo los soporta.
-- ============================================================

-- 1. Eliminar duplicados por (season, team) conservando la fila más reciente
DELETE FROM standings s
USING standings k
WHERE s.season_id = k.season_id
  AND s.team_id   = k.team_id
  AND (COALESCE(s.scraped_at, s.created_at), s.id) <
      (COALESCE(k.scraped_at, k.created_at), k.id);

-- 2. Normalizar: NULL → '' para que la unicidad funcione siempre
UPDATE standings SET group_name = '' WHERE group_name IS NULL;

-- 3. Sustituir la unicidad por una que trate NULL como ''
ALTER TABLE standings DROP CONSTRAINT IF EXISTS standings_season_id_team_id_group_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_standings_season_team_group
  ON standings (season_id, team_id, COALESCE(group_name, ''));

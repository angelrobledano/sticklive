-- Evidencia (SOLO LECTURA) para la migración 057_drop_unused_indexes.sql.
-- Comprueba que los índices que se van a borrar llevan sin usarse y que los
-- EXPLAIN de las queries reales no los consultan.
--
-- Ejecutar en el VPS, contra el postgres del compose:
--   cd /opt/sticklive
--   DC="docker compose -f docker-compose.prod.yml --env-file .env.prod"
--   $DC exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1' \
--     < deploy/verify-unused-indexes.sql
--
-- Nota: idx_scan se reinicia al reiniciar Postgres. Mira `stats_reset` (consulta
-- 2) para saber cuánto cubre el contador; si es muy reciente, mide un periodo
-- representativo antes de decidir.

\echo '== 1. idx_scan / tamanio de los indices candidatos =='
SELECT s.relname AS tabla, s.indexrelname AS indice, s.idx_scan,
       pg_size_pretty(pg_relation_size(s.indexrelid)) AS tam
FROM pg_stat_user_indexes s
WHERE s.indexrelname IN (
  'idx_teams_name_trgm','idx_players_name_trgm','idx_competitions_name_trgm',
  'idx_team_aliases_trgm','idx_users_device_id','idx_user_favorites_user')
ORDER BY s.relname, s.indexrelname;

\echo '== 2. Desde cuando cuentan los contadores (stats_reset) =='
SELECT stats_reset FROM pg_stat_database WHERE datname = current_database();

\echo '== 3. Tamano de las tablas implicadas =='
SELECT relname, n_live_tup AS filas,
       pg_size_pretty(pg_total_relation_size(relid)) AS total
FROM pg_stat_user_tables
WHERE relname IN ('teams','players','competitions','team_aliases','users','user_favorites')
ORDER BY relname;

\echo '== 4. Indices existentes por tabla (para ver duplicados) =='
SELECT t.relname AS tabla, i.relname AS indice, pg_get_indexdef(ix.indexrelid) AS definicion
FROM pg_index ix
JOIN pg_class i ON i.oid = ix.indexrelid
JOIN pg_class t ON t.oid = ix.indrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public'
  AND t.relname IN ('teams','players','competitions','team_aliases','users','user_favorites')
ORDER BY t.relname, i.relname;

\echo '== 5. EXPLAIN: similarity() (findSimilarTeamNames) — no debe usar GIN =='
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT t.id FROM teams t
 WHERE t.sport_id = (SELECT sport_id FROM teams WHERE sport_id IS NOT NULL LIMIT 1)
   AND similarity(lower(t.name), lower('barca')) >= 0.35;

\echo '== 6. EXPLAIN: strpos (busqueda global) — no puede usar GIN =='
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT t.id FROM teams t WHERE strpos(lower(t.name), 'bar') > 0 LIMIT 5;

\echo '== 7. EXPLAIN: lookups por device_id / user_id (deben usar el UNIQUE) =='
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT 1 FROM users WHERE device_id = 'no-existe';
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT 1 FROM user_favorites WHERE user_id = '00000000-0000-0000-0000-000000000000';

\echo '== 8. Indices sin uso en general (idx_scan = 0), top 30 por tamano =='
SELECT relname, indexrelname, idx_scan, pg_size_pretty(pg_relation_size(indexrelid)) AS tam
FROM pg_stat_user_indexes
WHERE idx_scan = 0
ORDER BY pg_relation_size(indexrelid) DESC
LIMIT 30;

-- ============================================================
-- Migración 057: eliminar índices sin uso (auditoría backend #333, ítem B7)
--
-- Se eliminan dos grupos de índices que solo cuestan mantenimiento y disco:
--
-- 1) Índices GIN trigram sin consumidor. Ninguna query puede usarlos:
--    · la búsqueda global filtra con strpos(translate(lower(col), …), $1):
--      strpos/LIKE no aprovechan GIN y no hay ningún LIKE/ILIKE en el código;
--    · findSimilarTeamNames usa similarity(), que NO consulta el índice GIN
--      (solo lo hace el operador % con pg_trgm.similarity_threshold, que no
--      se usa en ninguna parte);
--    · además la columna va envuelta en lower(), así que el índice sobre el
--      valor crudo ni siquiera aplicaría.
--    Evidencia en producción (B7): idx_scan = 0 en los cuatro y EXPLAIN con
--    Seq Scan (deploy/verify-unused-indexes.sql).
--
-- 2) Índices duplicados de constraints UNIQUE, redundantes para el planner:
--    · idx_users_device_id      ⊂ users.device_id UNIQUE (003)
--    · idx_user_favorites_user  ⊂ user_favorites UNIQUE (user_id, kind, ref_id) (015)
--
-- DROP INDEX (sin CONCURRENTLY): el runner ejecuta el fichero entero como una
-- sola query (transacción implícita) y estas tablas son pequeñas, así que el
-- lock es instantáneo. Idempotente y reversible: las definiciones originales
-- están en 001/022/003/015/045 por si hiciera falta recrear alguno.
-- Ver `deploy/verify-unused-indexes.sql` para la evidencia previa (idx_scan).
-- ============================================================

DROP INDEX IF EXISTS idx_teams_name_trgm;
DROP INDEX IF EXISTS idx_players_name_trgm;
DROP INDEX IF EXISTS idx_competitions_name_trgm;
DROP INDEX IF EXISTS idx_team_aliases_trgm;
DROP INDEX IF EXISTS idx_users_device_id;
DROP INDEX IF EXISTS idx_user_favorites_user;

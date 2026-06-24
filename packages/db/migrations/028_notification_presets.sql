-- ============================================================
-- Migración 028: presets de notificación POR ENTIDAD seguida
--
-- Hasta ahora la config de notificaciones era global por dispositivo
-- (booleanos en push_subscriptions.config). Pasamos a un preset por cada
-- follow (equipo/competición/jugador): complete | key_events | results | silent.
--
-- Almacenamiento: mapa JSONB clave "<tipo>:<id>" → preset, p.ej.
--   {"team:ccc...":"key_events","competition:d17...":"results"}
-- El cliente lo sube en el mismo payload de /push/subscribe.
-- En user_favorites guardamos el preset por fila para roaming con sesión.
-- ============================================================

ALTER TABLE push_subscriptions
  ADD COLUMN IF NOT EXISTS presets jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE user_favorites
  ADD COLUMN IF NOT EXISTS preset text;  -- NULL = complete (compatibilidad)

-- Backfill: todo lo ya seguido pasa a 'complete' para NO recortar avisos a los
-- usuarios actuales. Los follows nuevos elegirán preset en el modal (Fase 2);
-- mientras tanto, el emisor trata "seguido sin preset" como 'complete'.
UPDATE push_subscriptions ps SET presets = sub.map
FROM (
  SELECT p.endpoint,
         COALESCE(jsonb_object_agg(e.k, 'complete'), '{}'::jsonb) AS map
  FROM push_subscriptions p
  LEFT JOIN LATERAL (
    SELECT 'team:'||t::text        AS k FROM unnest(p.fav_teams)   AS t
    UNION ALL
    SELECT 'competition:'||l::text AS k FROM unnest(p.fav_leagues) AS l
    UNION ALL
    SELECT 'player:'||pl::text     AS k FROM unnest(p.fav_players) AS pl
  ) e ON true
  GROUP BY p.endpoint
) sub
WHERE ps.endpoint = sub.endpoint
  AND ps.presets = '{}'::jsonb;

UPDATE user_favorites SET preset = 'complete' WHERE preset IS NULL;

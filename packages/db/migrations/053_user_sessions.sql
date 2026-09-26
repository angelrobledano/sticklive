-- ============================================================
-- Migración 053: sesiones multi-dispositivo
--
-- Hasta ahora users.session_token guardaba UNA sesión: cada login
-- sobrescribía la anterior y el dispositivo previo se quedaba deslogueado
-- en silencio. Con user_sessions el usuario puede tener sesión simultánea
-- en PC, móvil y tablet.
--
--  · token_hash sigue siendo SHA-256 hex (herencia de la 023): en la BD
--    solo viven hashes, el token en claro va únicamente al cliente.
--  · Backfill: la sesión vigente de cada usuario migra tal cual, así que
--    nadie tiene que volver a iniciar sesión al desplegar (al contrario
--    que en la 023, que invalidó todo a propósito).
--  · users.session_token / users.session_expires_at quedan DEPRECATED:
--    no se leen ni se escriben desde 053. Se eliminan en una limpieza
--    futura cuando se confirme que nada los referencia.
--
-- Aditiva e idempotente (IF NOT EXISTS + ON CONFLICT DO NOTHING). El
-- backfill copia datos, no los reescribe: sin backup previo.
-- ============================================================

CREATE TABLE IF NOT EXISTS user_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at  TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ NOT NULL
);

-- Lookup por Bearer en cada request autenticada.
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_sessions_token_hash
  ON user_sessions (token_hash);

-- Purga por usuario (login) y borrado al deshabilitar.
CREATE INDEX IF NOT EXISTS idx_user_sessions_user
  ON user_sessions (user_id);

-- Backfill de la sesión única existente.
INSERT INTO user_sessions (user_id, token_hash, created_at, expires_at)
SELECT id, session_token, NOW(),
       COALESCE(session_expires_at, NOW() + make_interval(days => 90))
FROM users
WHERE session_token IS NOT NULL
ON CONFLICT (token_hash) DO NOTHING;

COMMENT ON COLUMN users.session_token IS
  'DEPRECATED desde 053: usar user_sessions. No se lee ni se escribe.';
COMMENT ON COLUMN users.session_expires_at IS
  'DEPRECATED desde 053: usar user_sessions. No se lee ni se escribe.';

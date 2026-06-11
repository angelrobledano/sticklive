-- ============================================================
-- Migración 015: autenticación progresiva (magic links + favoritos en nube)
--
-- Modelo: el usuario empieza anónimo (users.device_id, ya existente).
-- Al registrarse via magic link, su email se asocia al usuario y los
-- favoritos del localStorage se fusionan en user_favorites.
-- ============================================================

-- Email único cuando existe (los anónimos lo tienen NULL)
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email
  ON users (LOWER(email)) WHERE email IS NOT NULL;

-- Sesión simple por token opaco (MVP; rotar al hacer login)
ALTER TABLE users ADD COLUMN IF NOT EXISTS session_token TEXT UNIQUE;

-- Tokens de magic link (un solo uso, caducidad corta)
CREATE TABLE IF NOT EXISTS auth_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token       TEXT NOT NULL UNIQUE,
  email       TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Favoritos sincronizados en la nube
CREATE TABLE IF NOT EXISTS user_favorites (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('team', 'league')),
  ref_id      UUID NOT NULL,  -- team_id o competition_id
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, kind, ref_id)
);

CREATE INDEX IF NOT EXISTS idx_user_favorites_user ON user_favorites(user_id);

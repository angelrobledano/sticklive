-- ============================================================
-- Migración 016: estado de cuenta de usuario (panel de admin)
--
-- active   → cuenta normal
-- disabled → bloqueada por el admin: la API rechaza su sesión
-- ============================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'disabled'));

CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

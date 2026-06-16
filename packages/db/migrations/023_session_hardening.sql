-- ============================================================
-- Migración 023: endurecimiento de sesiones (auditoría S3)
--
--  · Los tokens (sesión y magic link) pasan a guardarse HASHEADOS (SHA-256).
--    No hay cambio de tipo de columna: 'session_token' y 'auth_tokens.token'
--    pasan a contener el hash hex (64 chars) en vez del token en claro.
--  · Se añade caducidad de sesión.
--
--  Efecto al desplegar: las sesiones existentes (token en claro) dejan de
--  validar → los usuarios tendrán que volver a iniciar sesión UNA vez.
--  Los magic links viejos también se invalidan (son de 15 min, irrelevante).
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS session_expires_at TIMESTAMPTZ;

-- Invalidar de forma limpia las sesiones en claro preexistentes (se re-login).
UPDATE users SET session_token = NULL, session_expires_at = NULL
WHERE session_token IS NOT NULL;

-- Índice para el lookup por hash de sesión (Bearer en cada request autenticada).
CREATE INDEX IF NOT EXISTS idx_users_session_token ON users (session_token)
  WHERE session_token IS NOT NULL;

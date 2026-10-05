-- ============================================================
-- Migración 065: login de la app móvil + tokens push nativos.
--
-- app_login_codes: código de un solo uso (2 min) que entrega el callback de
--  Google al scheme sticklive:// de la app. La sesión NUNCA viaja por el
--  custom scheme (puede ser interceptado por otra app): la app canjea el
--  código por Bearer vía POST /auth/exchange. Mismo patrón que auth_tokens:
--  se guarda el SHA-256 del código, nunca el código en claro.
-- push_tokens: suscripciones push de dispositivos nativos (Expo Push).
--  Misma segmentación que push_subscriptions (SubPrefs) pero para FCM/APNs.
--  user_id es NULL para dispositivos anónimos (por eso el índice es parcial).
--
-- Aditiva e idempotente: IF NOT EXISTS en todo; re-ejecutar no falla.
-- ============================================================

CREATE TABLE IF NOT EXISTS app_login_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash   TEXT NOT NULL UNIQUE,          -- SHA-256 hex del código (patrón auth_tokens)
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- El canje busca por code_hash (índice UNIQUE) y la higiene de caducados por
-- expires_at.
CREATE INDEX IF NOT EXISTS idx_app_login_codes_expiry
  ON app_login_codes (expires_at);

CREATE TABLE IF NOT EXISTS push_tokens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expo_push_token TEXT NOT NULL UNIQUE,      -- ExponentPushToken[xxxxxxxx...]
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  device_id       TEXT NOT NULL,
  platform        TEXT NOT NULL DEFAULT 'android',
  app_version     TEXT,
  locale          TEXT,
  fav_teams       JSONB NOT NULL DEFAULT '[]'::jsonb,
  fav_leagues     JSONB NOT NULL DEFAULT '[]'::jsonb,
  fav_players     JSONB NOT NULL DEFAULT '[]'::jsonb,
  presets         JSONB NOT NULL DEFAULT '{}'::jsonb,  -- "<tipo>:<id>" → preset (igual que push_subscriptions)
  config          JSONB NOT NULL DEFAULT '{}'::jsonb,  -- { master?, quietNight? } (igual que push_subscriptions)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Dispositivos anónimos (user_id NULL) no son consultables por usuario: índice parcial.
CREATE INDEX IF NOT EXISTS idx_push_tokens_user
  ON push_tokens (user_id) WHERE user_id IS NOT NULL;

COMMENT ON TABLE app_login_codes IS
  'Códigos de canje single-use (2 min) del login Google de la app móvil: el callback entrega code= por sticklive:// y la app lo canjea por Bearer vía POST /auth/exchange. Guarda el SHA-256, no el código.';
COMMENT ON TABLE push_tokens IS
  'Tokens de push nativo (Expo Push) por dispositivo. Misma segmentación que push_subscriptions; user_id NULL = dispositivo anónimo.';

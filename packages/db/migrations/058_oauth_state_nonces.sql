-- ============================================================
-- Migración 058: nonces del state OAuth consumidos (#306)
--
-- El state de OAuth (`lib/auth-state.ts`) va firmado (HMAC) y desde #306 lleva
-- `iat`/`exp`, pero un state firmado sigue siendo reutilizable mientras esté
-- vigente. Esta tabla da el single-use: el callback inserta el nonce con
-- `ON CONFLICT DO NOTHING` y solo continúa si era nuevo.
--
-- Es efímera: cada fila caduca con el propio state (≤ 10 min) y la API purga
-- los caducados de forma oportunista en cada login. `nonce` es la PK, así que
-- la comprobación es atómica entre instancias de la API (no memoria de proceso).
--
-- Idempotente: CREATE ... IF NOT EXISTS.
-- ============================================================

CREATE TABLE IF NOT EXISTS oauth_state_nonces (
  nonce      TEXT PRIMARY KEY,               -- nonce aleatorio del state OAuth
  expires_at TIMESTAMPTZ NOT NULL,           -- caduca con el state (≤ 10 min)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oauth_state_nonces_expires
  ON oauth_state_nonces(expires_at);

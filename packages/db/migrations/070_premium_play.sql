-- ============================================================
-- 070 — Premium de Google Play (suscripción anual + lifetime)
--
-- Añade monetización Play al sistema de pagos existente (Stripe). El guard
-- autoritativo pasa a ser:
--   premium_lifetime OR premium_until > NOW()
-- (auditoría S9: is_premium nunca se revierte y NO es fuente de verdad).
-- ============================================================

-- El "para siempre" de la compra única en Play. NULL/FALSE = no lifetime
-- (NO cambiar la semántica de premium_until: los usuarios gratis ya tienen NULL).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS premium_lifetime BOOLEAN NOT NULL DEFAULT FALSE;

-- ============================================================
-- PLAY_PURCHASES: registro de compras Play, idempotente por
-- purchase_token (patrón processed_stripe_events: UNIQUE + ON CONFLICT).
-- state refleja lo que dice Google, revalidado por el job diario
-- play-reconcile.
-- ============================================================
CREATE TABLE IF NOT EXISTS play_purchases (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id),
  product_id     TEXT NOT NULL CHECK (product_id IN ('premium_annual', 'premium_lifetime')),
  purchase_token TEXT NOT NULL UNIQUE,
  order_id       TEXT,
  state          TEXT NOT NULL CHECK (state IN ('active', 'expired', 'revoked')),
  expires_at     TIMESTAMPTZ,              -- NULL en lifetime
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_play_purchases_user
  ON play_purchases (user_id);

-- El reconciler busca suscripciones anuales activas que revalidar.
CREATE INDEX IF NOT EXISTS idx_play_purchases_active_annual
  ON play_purchases (expires_at)
  WHERE state = 'active' AND product_id = 'premium_annual';

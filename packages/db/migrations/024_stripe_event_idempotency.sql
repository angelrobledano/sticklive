-- ============================================================
-- Migración 024: idempotencia del webhook de Stripe (auditoría S9)
--
-- Stripe puede entregar el mismo evento varias veces. Registramos los
-- event_id ya procesados para no aplicar el efecto (activar premium) dos veces.
-- ============================================================

CREATE TABLE IF NOT EXISTS processed_stripe_events (
  event_id     TEXT PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

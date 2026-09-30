-- ============================================================
-- 063 — Customer de Stripe en users (#251: flujo de restore).
--
-- El premium es por dispositivo (users.device_id): al reinstalar o cambiar de
-- móvil el entitlement se pierde porque no había NADA que casar. Guardando el
-- customer de Stripe de cada compra, el restore puede localizar los pagos por
-- el email que el propio Checkout recolecta para ese customer.
--
-- UNIQUE parcial: un customer por usuario, pero varios usuarios históricos
-- podrían apuntar al mismo customer tras un restore (el restore REESCRIBE el
-- stripe_customer_id del dispositivo nuevo hacia el customer pagado) — por eso
-- no puede ser UNIQUE global sin cláusula; se deja sin UNIQUE y el flujo de
-- restore es el único escritor.
-- ============================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer
  ON users (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

COMMENT ON COLUMN users.stripe_customer_id IS
  'Customer de Stripe de la compra (restore #251). Lo escribe el checkout y lo reescribe el restore hacia el customer del pago localizado por email.';

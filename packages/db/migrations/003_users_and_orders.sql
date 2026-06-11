-- ============================================================
-- Migración 003: Usuarios (device-based) y Pedidos de pago
-- ============================================================

-- ============================================================
-- USUARIOS (identificados por device_id generado en cliente)
-- Sin sistema de auth completo todavía; la identidad es el
-- UUID generado en el navegador y guardado en localStorage.
-- ============================================================
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id       TEXT NOT NULL UNIQUE,  -- UUID generado en cliente
  is_premium      BOOLEAN NOT NULL DEFAULT FALSE,
  premium_until   TIMESTAMPTZ,           -- NULL = sin fecha de expiración
  email           TEXT,                  -- Opcional, recogido en checkout
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_device_id ON users(device_id);

-- ============================================================
-- PEDIDOS de pago a través de Redsys
-- ds_order es el número de pedido de 12 caracteres enviado
-- a la pasarela; es único y sirve de clave de correlación
-- entre el /create-json y el /webhook posterior.
-- ============================================================
CREATE TABLE orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id),
  -- Datos Redsys
  ds_order        VARCHAR(12) NOT NULL UNIQUE,  -- Número de pedido Redsys
  amount_cents    INT NOT NULL,                 -- 499 = 4,99 €
  currency        CHAR(3) NOT NULL DEFAULT '978', -- 978 = EUR
  -- Estado del pago
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'authorized', 'failed', 'refunded')),
  ds_response     TEXT,       -- Código de respuesta Redsys (0000-0099 = OK)
  ds_auth_code    TEXT,       -- Código de autorización del banco
  ds_card_country TEXT,       -- País del titular de la tarjeta
  -- Metadatos
  webhook_raw     JSONB,      -- Payload completo del webhook, para auditoría
  authorized_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_orders_user_id  ON orders(user_id);
CREATE INDEX idx_orders_ds_order ON orders(ds_order);
CREATE INDEX idx_orders_status   ON orders(status);

-- Trigger updated_at
CREATE TRIGGER trg_users_updated_at  BEFORE UPDATE ON users  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_orders_updated_at BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION update_updated_at();

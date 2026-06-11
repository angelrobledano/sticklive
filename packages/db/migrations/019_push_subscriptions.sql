-- ============================================================
-- Migración 019: suscripciones Web Push
--
-- Una fila por navegador/dispositivo suscrito. Las preferencias y los
-- favoritos viven en el cliente (localStorage); el cliente los SINCRONIZA
-- aquí en cada cambio para que el emisor (cron-live) pueda segmentar sin
-- pedir login: las push funcionan también para usuarios anónimos.
-- ============================================================

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id   TEXT NOT NULL,
  endpoint    TEXT NOT NULL UNIQUE,        -- URL del push service del navegador
  p256dh      TEXT NOT NULL,               -- clave pública del cliente
  auth        TEXT NOT NULL,               -- secreto de autenticación
  fav_teams   UUID[] NOT NULL DEFAULT '{}',
  config      JSONB  NOT NULL DEFAULT '{}',  -- NotifConfig del cliente
  locale      TEXT   NOT NULL DEFAULT 'es',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_subs_device ON push_subscriptions(device_id);

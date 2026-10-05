-- ============================================================
-- Migración 066: ledger del resumen matinal POR CANAL (web | native).
--
-- Task 4.3: el resumen matinal se entrega por DOS canales (web-push y Expo
-- Push) con la misma selección (`morningPendingSubs`). Con el ledger único de
-- la 056, un dispositivo nativo no podría registrarse su entrega sin chocar
-- (o ser comido por `ON CONFLICT DO NOTHING`) con la fila del homónimo web del
-- mismo día, y al revés. Cada canal lleva su propio registro y su propio
-- reintento: la columna `channel` ('web' por defecto = todas las filas
-- históricas, que solo eran del canal web) y el único pasa de
-- (subscription_id, day) a (day, subscription_id, channel).
--
-- Dos ajustes más, necesarios para el canal nativo:
--   · La PK de la 056 se sustituye por el índice único de tres columnas
--     (idempotente; una PK no se puede añadir con IF NOT EXISTS).
--   · Se retira la FK a push_subscriptions(id): `subscription_id` ahora puede
--     referir push_subscriptions.id (web) o push_tokens.id (nativo). Es un
--     ledger de auditoría consultado por día: una fila huérfana de un
--     dispositivo ya borrado es inofensiva (solo se cruza contra las
--     suscripciones vivas de la pasada en curso), y perder el CASCADE no
--     deja datos malos, solo filas de auditoría antiguas.
--
-- Migración NUEVA a propósito: la 065 ya está aplicada en entornos reales y
-- añadirle un ALTER rompería su idempotencia percibida. Aditiva e idempotente
-- (IF EXISTS / IF NOT EXISTS en todo): re-ejecutar no falla.
-- ============================================================

ALTER TABLE push_summary_log ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'web';

-- Constraint real de la 056: PRIMARY KEY (subscription_id, day) → push_summary_log_pkey.
ALTER TABLE push_summary_log DROP CONSTRAINT IF EXISTS push_summary_log_pkey;

CREATE UNIQUE INDEX IF NOT EXISTS uq_push_summary_log_day_sub_channel
  ON push_summary_log (day, subscription_id, channel);

-- FK generada por la 056 (REFERENCES inline → nombre table_column_fkey).
ALTER TABLE push_summary_log DROP CONSTRAINT IF EXISTS push_summary_log_subscription_id_fkey;

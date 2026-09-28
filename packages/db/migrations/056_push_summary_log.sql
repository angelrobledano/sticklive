-- ============================================================
-- Migración 056: ledger de resúmenes matinales (auditoría #383)
--
-- El resumen matinal de `quietNight` (#272) deduplicaba solo en MEMORIA del
-- proceso (`morningSummarySent`/`morningSummaryDate`). Dos consecuencias:
--
--   · Si el cron se reiniciaba entre las 08:00 y las 12:00 (o el proceso
--     cambiaba), el resumen podía reenviarse.
--   · El resumen solo se intentaba cuando el dispatcher corría por actividad;
--     un día tranquilo no lo disparaba (se corrige en cron-live.ts).
--
-- Esta tabla da idempotencia PERSISTENTE: una fila por (suscripción, día local
-- de Madrid) ya servida. Con `ON CONFLICT DO NOTHING`, reintentos y múltiples
-- invocaciones del cron no duplican.
-- ============================================================

CREATE TABLE IF NOT EXISTS push_summary_log (
  subscription_id UUID NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
  day             DATE NOT NULL,                              -- día local Europe/Madrid
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (subscription_id, day)
);

CREATE INDEX IF NOT EXISTS idx_push_summary_day ON push_summary_log(day);

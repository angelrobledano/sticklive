-- ============================================================
-- 049 — A5 Fase 1: soporte de lotes 'enrich' + registro de cambios reversible.
--
-- El volcado (048) dejó el archivo histórico en prod como SOLO MARCADOR, en una
-- temporada colapsada 'Histórico' con scheduled_at NULL. Recuperar la fecha y la
-- temporada real de esos partidos es un ENRICH: un UPDATE de filas NATIVAS de
-- prod (scheduled_at + season_id), no un alta. A4 (promote-to-prod) es add-only
-- ("prod manda", ON CONFLICT DO NOTHING) y no puede hacerlo. Ver el diseño en
-- docs/A5_ENRICH_PROMOTE.md.
--
-- Como es la PRIMERA operación que sobrescribe dato nativo de prod, cada cambio
-- se registra aquí para revertir al valor exacto anterior, por lote.
-- ============================================================

-- 1. Un cuarto tipo de lote: 'enrich'. Reusa import_batches para trazar/revertir.
ALTER TABLE import_batches DROP CONSTRAINT IF EXISTS import_batches_kind_check;
ALTER TABLE import_batches ADD CONSTRAINT import_batches_kind_check
  CHECK (kind IN ('historic', 'backfill', 'manual', 'enrich'));

-- 2. Valor anterior de cada partido enriquecido, para revertir por lote:
--    UPDATE matches SET season_id=old_season_id, scheduled_at=old_scheduled_at ...
CREATE TABLE IF NOT EXISTS enrich_changes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id         uuid NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  match_id         uuid NOT NULL,
  old_season_id    uuid,
  old_scheduled_at timestamptz,
  created_at       timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_enrich_changes UNIQUE (batch_id, match_id)
);
CREATE INDEX IF NOT EXISTS ix_enrich_changes_batch ON enrich_changes (batch_id);

COMMENT ON TABLE enrich_changes IS
  'A5 enrich-promote: valor anterior (season_id, scheduled_at) de cada partido enriquecido en prod, para revertir por lote. Ver migración 049 y docs/A5_ENRICH_PROMOTE.md';

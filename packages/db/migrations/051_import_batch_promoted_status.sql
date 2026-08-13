-- ============================================================
-- 051 — Permitir status='promoted' en import_batches.
--
-- Tanto promote-to-prod (A4) como enrich-promote (A5) marcan el lote como
-- 'promoted' al llevarlo a producción, pero el CHECK de la migración 048 solo
-- admitía running|completed|reverted. Saltó en la PRIMERA promoción real
-- (transacción abortada, prod intacto). Añadimos 'promoted'.
-- ============================================================
ALTER TABLE import_batches DROP CONSTRAINT IF EXISTS import_batches_status_check;
ALTER TABLE import_batches ADD CONSTRAINT import_batches_status_check
  CHECK (status IN ('running', 'completed', 'reverted', 'promoted'));

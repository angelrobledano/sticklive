-- ============================================================
-- 034 — Rendimiento del directo e identidad estable de los eventos.
--
-- Dos cosas distintas que van juntas porque las dos son del Bloque 1 de la
-- auditoría de arquitectura (19/07/2026):
--
--   (a) Índices compuestos para /matches/current y /matches/live. Hasta ahora
--       matches sólo tenía índices SUELTOS (season_id, status, scheduled_at),
--       inservibles para el patrón real de la home: filtrar por temporada
--       actual y ventana de fechas, o por status='live'.
--
--   (b) UNIQUE(match_id, source_ref) en match_events. La ficha reescribía los
--       eventos con DELETE + INSERT cada ciclo (~45 s), así que cada gol
--       cambiaba de UUID constantemente: el timeline del cliente se re-renderiza
--       entero y el push-dispatcher no puede diffear por id (tiene que hacerlo
--       por CONTEO, que pierde notificaciones si la fuente corrige un evento en
--       el mismo ciclo). Con esta constraint el loader puede hacer upsert.
--
-- NOTA: se usa CREATE INDEX sin CONCURRENTLY a propósito. El runner
-- (packages/db/src/migrate.ts) ejecuta cada fichero como una sola sentencia,
-- lo que abre una transacción implícita, y CONCURRENTLY no puede correr dentro
-- de una transacción. Las tablas son pequeñas (una liga) y el lock es de ms.
-- Si algún día estas tablas crecen, aplicar los índices a mano con
-- CONCURRENTLY fuera del runner.
-- ============================================================

-- ── (a) Índices del directo ─────────────────────────────────────────────────

-- /matches/current: JOIN seasons (is_current) + ventana sobre scheduled_at.
CREATE INDEX IF NOT EXISTS idx_matches_season_scheduled
  ON matches(season_id, scheduled_at);

-- /matches/live: sólo interesan los que están en juego. Índice PARCIAL: pesa
-- unas pocas filas en lugar de la tabla entera.
CREATE INDEX IF NOT EXISTS idx_matches_live_partial
  ON matches(scheduled_at)
  WHERE status = 'live';

-- cron-live (checkWindow) filtra por (season_id, status, scheduled_at).
CREATE INDEX IF NOT EXISTS idx_matches_season_status_scheduled
  ON matches(season_id, status, scheduled_at);

-- ── (b) Identidad estable de los eventos ────────────────────────────────────

-- Dedupe previo: con DELETE + INSERT no debería haber duplicados vivos, pero
-- un ciclo interrumpido a medias pudo dejarlos. Conservamos la fila más
-- reciente de cada (match_id, source_ref).
DELETE FROM match_events me
WHERE me.source_ref IS NOT NULL
  AND me.id <> (
    SELECT keep.id FROM match_events keep
    WHERE keep.match_id   = me.match_id
      AND keep.source_ref = me.source_ref
    ORDER BY keep.created_at DESC, keep.id DESC
    LIMIT 1
  );

-- Parcial: los eventos históricos importados sin source_ref quedan fuera y no
-- bloquean la migración.
CREATE UNIQUE INDEX IF NOT EXISTS uq_match_events_match_source_ref
  ON match_events(match_id, source_ref)
  WHERE source_ref IS NOT NULL;

COMMENT ON INDEX uq_match_events_match_source_ref IS
  'Idempotencia de la ficha: permite INSERT ... ON CONFLICT en vez de DELETE + INSERT, manteniendo estable el id de cada evento entre ciclos de scraping.';

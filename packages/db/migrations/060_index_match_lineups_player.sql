-- ============================================================
-- 060 — Índice por player_id en match_lineups (#318).
--
-- CONTEXTO (verificado sobre prod 30/09/2026): match_lineups tiene ~38.000
-- filas y ningún índice por player_id. Las queries de ficha de jugador
-- (player-detail, season-stats) filtran ml.player_id y hoy resuelven con Seq
-- Scan de la tabla completa. Con el volumen actual el scan es de ms; el índice
-- es PREVENTIVO para cuando el volcado histórico (millones de filas, #235)
-- aterrice en prod — mismo criterio defensivo que la 052.
--
-- Igual que en 052: CREATE INDEX IF NOT EXISTS y NO CONCURRENTLY. El runner
-- manda el fichero como una sola cadena (transacción implícita) y
-- CONCURRENTLY no puede correr dentro. Con 38.000 filas el lock es de ms.
-- Si el volcado histórico llega ANTES de aplicar esta migración, construir
-- antes a mano siguiendo docs/runbook-indices-grandes.md (esta migración sería
-- entonces no-op).
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_match_lineups_player
  ON match_lineups (player_id)
  WHERE player_id IS NOT NULL;

COMMENT ON INDEX idx_match_lineups_player IS
  'Acceso por jugador en alineaciones (PJ real de la ficha, goles/asistencias por temporada). Preventivo para el volcado histórico; en prod con tablas grandes, construir vía docs/runbook-indices-grandes.md antes de desplegar (#318).';

-- ============================================================
-- 061 — Ref de acta en match_lineups (#219).
--
-- Las alineaciones traen el `id_player` del acta (mismo ancla que las
-- incidencias) pero hasta ahora se descartaba: el vínculo alineación→jugador
-- era por NOMBRE normalizado (last-wins) y un 41% de alineaciones quedaba sin
-- link (jugadores invisibles sin evento). Con la ref guardada, la vinculación
-- es EXACTA (player_source_ref = players.source_ref) y re-ejecutable sin
-- heurística — ver link-lineup-players.ts.
--
-- SIN índice por ahora: el backfill puntual la usa una vez y el volumen
-- (38k filas) no justifica el coste de escritura por ciclo del directo. Si el
-- re-fichas histórico (#232) la convierte en camino caliente, se añade.
-- ============================================================

ALTER TABLE match_lineups ADD COLUMN IF NOT EXISTS player_source_ref TEXT;

COMMENT ON COLUMN match_lineups.player_source_ref IS
  'Ref del acta (fep_player_{id_player}) para vinculación exacta con players.source_ref sin heurística de nombre (#219).';

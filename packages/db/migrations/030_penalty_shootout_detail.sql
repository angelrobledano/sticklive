-- ============================================================
-- Migración 030: detalle de la tanda de penaltis (lanzador a lanzador)
--
-- home_pen/away_pen ya guardan el marcador de la tanda. Aquí guardamos el
-- desglose: cada lanzamiento con jugador y si marcó o falló, para mostrarlo en
-- el resumen del partido (no solo el agregado).
--
-- Formato: { "home": [{ "player": "...", "scored": true }, ...],
--            "away": [{ "player": "...", "scored": false }, ...] }
-- En orden de lanzamiento por equipo; se omiten los que no llegaron a lanzar.
-- ============================================================

ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS penalty_shootout jsonb;

COMMENT ON COLUMN matches.penalty_shootout IS
  'Desglose de la tanda: { home:[{player,scored}], away:[{player,scored}] } en orden de lanzamiento.';

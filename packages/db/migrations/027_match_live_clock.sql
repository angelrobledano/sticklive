-- ============================================================
-- 027 — Estado en vivo del partido: fase (periodo/descanso) y crono.
--
-- La cabecera de la ficha (rfep_gr) trae el marcador en directo con:
--   #game_period (.periodo_activo)  → "PERIODO 1/2" | "DESCANSO" | "FINAL"
--   #game_time                      → MM:SS RESTANTE del periodo en curso
--
-- Persistimos esa fase + el crono restante junto al instante de captura para
-- que el cliente lo haga correr localmente (tick) y resincronice en cada poll.
-- Solo es relevante mientras status='live'.
-- ============================================================

ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS live_period        smallint,
  ADD COLUMN IF NOT EXISTS live_clock_seconds integer,      -- restante en el periodo en curso (seg)
  ADD COLUMN IF NOT EXISTS live_clock_at      timestamptz,  -- instante de captura (ancla para el tick del cliente)
  ADD COLUMN IF NOT EXISTS live_is_halftime   boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN matches.live_clock_seconds IS
  'Tiempo RESTANTE del periodo en curso, en segundos (la fuente cuenta atras desde 25:00). El transcurrido = 1500 - este valor.';

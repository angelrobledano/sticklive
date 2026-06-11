-- ============================================================
-- Migración 018: crono real del evento
--
-- En hockey patines el reloj CUENTA ATRÁS desde 25:00 por parte.
-- La ficha publica el instante exacto restante ("12:34"); hasta ahora
-- solo guardábamos el minuto transcurrido derivado. clock conserva el
-- tiempo restante MM:SS tal y como lo mostraba el marcador.
-- Se rellena al (re)procesar actas; NULL en eventos antiguos.
-- ============================================================

ALTER TABLE match_events ADD COLUMN IF NOT EXISTS clock TEXT;

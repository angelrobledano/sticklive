-- ============================================================
-- Migración 008: tipos de evento 'foul' y 'direct_foul'
-- · foul        — falta de equipo individual (de la ficha resumen).
--                 Permite calcular las marcas de 10ª/15ª falta en la
--                 cronología (en hockey patines implican falta directa).
-- · direct_foul — lanzamiento de falta directa. detail = 'marcada'/'fallada'
--                 (inferido cruzando con los goles del mismo equipo en el
--                 mismo instante de la ficha).
-- ============================================================

ALTER TABLE match_events DROP CONSTRAINT IF EXISTS match_events_event_type_check;
ALTER TABLE match_events ADD CONSTRAINT match_events_event_type_check
  CHECK (event_type IN ('goal', 'penalty', 'blue_card', 'red_card', 'timeout', 'period_end', 'foul', 'direct_foul'));

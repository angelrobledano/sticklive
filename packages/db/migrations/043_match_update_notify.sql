-- 043 · NOTIFY en cambios de partido (punto 11 — LISTEN/NOTIFY)
--
-- Invierte el flujo del directo de PULL a PUSH sin añadir infraestructura: en
-- vez de que el hub SSE de la API sondee la BD cada 15 s, la BD AVISA cuando un
-- partido cambia. La API mantiene un `LISTEN match_update` y refresca sólo el
-- partido notificado, al instante. (Ver apps/api/src/routes/match-stream.ts.)
--
-- El payload del NOTIFY es el UUID del partido (matches.id). La API sólo
-- reacciona si tiene un hub abierto para ese partido; los avisos de partidos sin
-- espectadores se ignoran, así que el coste aquí es un pg_notify barato.
--
-- Ventaja de hacerlo por trigger y no en el ETL: cualquier escritura (marcador,
-- eventos, reloj, faltas) — venga de donde venga — dispara el aviso sin acoplar
-- el código del ETL.

CREATE OR REPLACE FUNCTION notify_match_row() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('match_update', (CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END)::text);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION notify_match_event_row() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('match_update', (CASE WHEN TG_OP = 'DELETE' THEN OLD.match_id ELSE NEW.match_id END)::text);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- matches: al insertar (partido nuevo) siempre; al actualizar, sólo si cambia
-- algo que el directo muestra (evita ruido por el upsert del cron horario, que
-- reescribe filas sin cambios reales).
DROP TRIGGER IF EXISTS trg_matches_notify_ins ON matches;
CREATE TRIGGER trg_matches_notify_ins
  AFTER INSERT ON matches
  FOR EACH ROW EXECUTE FUNCTION notify_match_row();

DROP TRIGGER IF EXISTS trg_matches_notify_upd ON matches;
CREATE TRIGGER trg_matches_notify_upd
  AFTER UPDATE ON matches
  FOR EACH ROW
  WHEN (NEW.status             IS DISTINCT FROM OLD.status
     OR NEW.home_score         IS DISTINCT FROM OLD.home_score
     OR NEW.away_score         IS DISTINCT FROM OLD.away_score
     OR NEW.home_fouls         IS DISTINCT FROM OLD.home_fouls
     OR NEW.away_fouls         IS DISTINCT FROM OLD.away_fouls
     OR NEW.live_period        IS DISTINCT FROM OLD.live_period
     OR NEW.live_clock_seconds IS DISTINCT FROM OLD.live_clock_seconds
     OR NEW.live_is_halftime   IS DISTINCT FROM OLD.live_is_halftime)
  EXECUTE FUNCTION notify_match_row();

-- match_events: cualquier alta/cambio/baja de evento es relevante para el directo.
DROP TRIGGER IF EXISTS trg_match_events_notify ON match_events;
CREATE TRIGGER trg_match_events_notify
  AFTER INSERT OR UPDATE OR DELETE ON match_events
  FOR EACH ROW EXECUTE FUNCTION notify_match_event_row();

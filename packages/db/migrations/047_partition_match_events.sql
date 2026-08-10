-- ============================================================
-- 047 — Particionar match_events por temporada (RANGE sobre match_date).
--
-- Se hace con la tabla PEQUEÑA, ANTES del volcado histórico de 25 temporadas
-- (backlog #1). Así el volcado entra ya particionado y evitamos una migración
-- con bloqueo ACCESS EXCLUSIVE reescribiendo millones de filas y sus índices.
--
-- Claves del diseño (verificadas en Postgres 16):
--
--   · No existe ALTER TABLE ... PARTITION BY: hay que crear tabla nueva + swap.
--
--   · La columna de partición (match_date) DEBE ir en toda restricción única, así
--     que el índice de idempotencia del directo pasa de (match_id, source_ref) a
--     (match_id, source_ref, match_date), MANTENIENDO el predicado parcial
--     WHERE source_ref IS NOT NULL. (match_date es funcionalmente dependiente de
--     match_id, así que (match_id, source_ref) sigue siendo único de hecho.)
--
--   · match_date está en la PK => NOT NULL implícito: un NULL NO enruta a la
--     partición DEFAULT. Los partidos sin scheduled_at usan COALESCE a un
--     centinela (1900-01-01) que cae en match_events_undated. No se pone DEFAULT
--     a la columna a propósito: un default silencioso enrutaría eventos a la
--     partición equivocada (footgun tipo B1 de la auditoría). El único inserter
--     de producción es replaceMatchEvents, que rellena match_date desde el
--     partido.
--
--   · El trigger de NOTIFY de la 043 (trg_match_events_notify) vive en la tabla
--     vieja: se recrea sobre el padre particionado. Un trigger de fila en el
--     padre se aplica a TODAS las particiones, presentes y futuras.
--
-- No se usa CONCURRENTLY: el runner (migrate.ts) manda el fichero como una sola
-- cadena => transacción implícita, donde CONCURRENTLY no puede correr. La tabla
-- es pequeña, el lock es de ms. Si algún día se rehiciera con la tabla llena,
-- los índices habría que crearlos con CONCURRENTLY fuera del runner.
-- ============================================================

-- (a) Tabla particionada nueva.
CREATE TABLE match_events_part (
  id         uuid  NOT NULL DEFAULT gen_random_uuid(),
  match_id   uuid  NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  team_id    uuid  REFERENCES teams(id),
  player_id  uuid  REFERENCES players(id),
  event_type text  NOT NULL CHECK (event_type IN
              ('goal','penalty','blue_card','red_card','timeout','period_end','foul','direct_foul')),
  minute     int,
  period     int,
  clock      text,
  detail     text,
  source_id  uuid  REFERENCES data_sources(id),
  source_ref text,
  scraped_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  match_date date  NOT NULL,               -- denormalizado del partido (inmutable)
  PRIMARY KEY (id, match_date)
) PARTITION BY RANGE (match_date);

-- (a2) Los índices viejos comparten nombre con los nuevos (los nombres de índice
--      son globales en Postgres). Se eliminan antes; la copia posterior es un
--      INSERT ... SELECT que no los necesita.
DROP INDEX IF EXISTS uq_match_events_match_source_ref;
DROP INDEX IF EXISTS idx_match_events_match;

-- (b) Idempotencia del upsert. Mismo NOMBRE de índice que 034/035/036 para que
--     el check del CI (job "migrations") lo siga encontrando. Se propaga a cada
--     partición.
CREATE UNIQUE INDEX uq_match_events_match_source_ref
  ON match_events_part (match_id, source_ref, match_date)
  WHERE source_ref IS NOT NULL;

COMMENT ON INDEX uq_match_events_match_source_ref IS
  'Idempotencia de la ficha. La ref se deriva del contenido (035/036). Desde la 047 la tabla es particionada por match_date, que se añade a la clave única por exigencia de Postgres (la columna de partición va en toda restricción única).';

-- (c) Índice del acceso caliente. Incluir match_date permite podar a UNA sola
--     partición cuando la consulta pasa la fecha del partido (replaceMatchEvents
--     y las lecturas del directo, que siempre tienen el partido cargado).
CREATE INDEX idx_match_events_match ON match_events_part (match_id, match_date);

-- (d) Particiones: una por temporada de hockey (1-ago -> 1-ago). Rango amplio
--     para cubrir el histórico (desde 2001/02) y varias temporadas futuras.
--     Regla operativa: crear la partición de la temporada siguiente ANTES de que
--     empiece (añadir al runbook de alta de competición/temporada).
DO $$
DECLARE y int;
BEGIN
  FOR y IN 2001..2035 LOOP
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS match_events_s%s PARTITION OF match_events_part
         FOR VALUES FROM (%L) TO (%L)',
      y, (y || '-08-01')::date, ((y + 1) || '-08-01')::date);
  END LOOP;
END $$;

-- Centinela para partidos sin fecha (COALESCE -> 1900-01-01). Debe quedar VACÍA
-- en régimen normal: si recibe filas, es señal de partidos sin scheduled_at.
CREATE TABLE IF NOT EXISTS match_events_undated PARTITION OF match_events_part
  FOR VALUES FROM ('1900-01-01') TO ('1901-01-01');

-- (e) Copiar lo existente (poco: temporada actual). match_date desde el partido.
INSERT INTO match_events_part
  (id, match_id, team_id, player_id, event_type, minute, period, clock, detail,
   source_id, source_ref, scraped_at, created_at, match_date)
SELECT e.id, e.match_id, e.team_id, e.player_id, e.event_type, e.minute, e.period,
       e.clock, e.detail, e.source_id, e.source_ref, e.scraped_at, e.created_at,
       COALESCE(m.scheduled_at::date, m.finished_at::date, DATE '1900-01-01')
FROM match_events e
JOIN matches m ON m.id = e.match_id;

-- (f) Swap.
ALTER TABLE match_events      RENAME TO match_events_old;
ALTER TABLE match_events_part RENAME TO match_events;
DROP TABLE match_events_old;

-- (g) Recrear el trigger de NOTIFY de la 043 sobre el padre particionado.
--     notify_match_event_row() ya existe (la 043 no la borra).
DROP TRIGGER IF EXISTS trg_match_events_notify ON match_events;
CREATE TRIGGER trg_match_events_notify
  AFTER INSERT OR UPDATE OR DELETE ON match_events
  FOR EACH ROW EXECUTE FUNCTION notify_match_event_row();

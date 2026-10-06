-- ============================================================
-- 067 — Fiabilidad de la temporada (ocultado por calidad).
--
-- Hoy `competitions.data_quality` (#230, migración 064) se ETIQUETA en la web
-- ("Datos en revisión") pero no se oculta. El producto pasa a ocultar: una
-- competición o temporada con data_quality <> 'ok' deja de ser consultable por
-- el usuario (listados, búsqueda, URL directa, endpoints de temporada, fichas
-- de partido, historial de equipo y carrera de jugador).
--
-- Regla única: temporada visible ⇔ seasons.data_quality='ok' AND
-- competitions.data_quality='ok'. La competición actúa de interruptor maestro.
--
-- Visible por defecto: NO hay backfill. Ocultar es una acción explícita de
-- curación desde el panel admin.
--
-- Idempotente y aditiva.
-- ============================================================

ALTER TABLE seasons
  ADD COLUMN IF NOT EXISTS data_quality TEXT NOT NULL DEFAULT 'ok'
    CHECK (data_quality IN ('ok', 'en_revision'));

COMMENT ON COLUMN seasons.data_quality IS
  'Fiabilidad de la temporada: ok (defecto) | en_revision. Si no es ok, la temporada y todo su contenido (calendario, clasificación, partidos y fichas derivadas) dejan de ser consultables por el usuario. Ver migración 067.';

COMMENT ON COLUMN competitions.data_quality IS
  'Fiabilidad de la competición: ok | en_revision. Ya no se etiqueta: un valor distinto de ok oculta la competición y todo su contenido para el usuario (migraciones 064 y 067).';

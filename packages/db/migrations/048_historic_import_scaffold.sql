-- ============================================================
-- 048 — Andamiaje para el volcado histórico: cobertura de eventos + traza de lote.
--
-- El volcado histórico (backlog #1) trae ~10 temporadas de resultados de una
-- BD anterior (pg_dump previo al vaciado del 16/06). El análisis de esa fuente
-- dejó dos hechos que ESTA migración convierte en modelo:
--
--   1. Los eventos históricos NO son fiables. En el 83% de los partidos
--      terminados la suma de goles-evento no cuadra con el marcador; el 86% de
--      los eventos no tienen jugador y el 67% no tienen equipo. Lo ÚNICO fiable
--      a nivel partido es el MARCADOR (home_score/away_score, presente en el
--      99%). Por eso el volcado v1 importa RESULTADO, no el stream de eventos.
--
--   2. Hay que poder distinguir, a nivel de fila, un partido con datos de
--      evento de verdad (los actuales de producción, que alimentan el directo
--      y las fichas) de un partido histórico del que solo sabemos el marcador.
--      Sin esa marca, la UI enseñaría un timeline vacío o inventado en cientos
--      de partidos y el usuario no sabría que ahí no hay detalle.
--
-- Y una necesidad operativa: el volcado se hace por FASES e incrementos. Cada
-- corrida tiene que poder revertirse entera sin tocar lo que ya sirve prod, así
-- que cada fila importada queda atada a un LOTE identificable.
--
-- Todo lo que sigue es ADITIVO: columnas y una tabla nuevas. No reescribe ni
-- borra datos existentes. Los `matches` actuales quedan marcados 'full' (son
-- de grado-evento) por el DEFAULT, sin UPDATE ni reescritura de la tabla.
--
-- Lo que NO hace falta añadir (ya existe en el modelo): la procedencia por
-- fila. matches/teams/competitions/seasons/players/standings ya tienen
-- source_id → data_sources, source_ref, source_url y scraped_at. El volcado
-- crea UNA fila en data_sources (la fuente histórica) y cuelga de ahí todo lo
-- que importe; revertir el volcado completo = borrar por ese source_id, y
-- revertir una corrida concreta = borrar por import_batch_id.
-- ============================================================

-- ── 1. matches.event_coverage ──────────────────────────────────────────────
-- Señal de fiabilidad del detalle de eventos del partido:
--   'full'    — eventos completos y cuadrados (partidos de prod, grado-evento).
--   'partial' — hay eventos pero incompletos (reservado; hoy no lo usa nadie).
--   'none'    — solo marcador; sin detalle de eventos fiable (volcado histórico).
--
-- DEFAULT 'full': los inserts del scraper de prod son de grado-evento, y las
-- filas ya existentes son todas de prod. El importador histórico pone 'none'
-- explícitamente. Añadir la columna con DEFAULT constante es metadata-only en
-- PG≥11: no reescribe `matches`.
ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS event_coverage text NOT NULL DEFAULT 'full';

-- CHECK con guard idempotente (PG no soporta ADD CONSTRAINT IF NOT EXISTS).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'matches_event_coverage_check'
  ) THEN
    ALTER TABLE matches
      ADD CONSTRAINT matches_event_coverage_check
      CHECK (event_coverage IN ('full', 'partial', 'none'));
  END IF;
END $$;

COMMENT ON COLUMN matches.event_coverage IS
  'Fiabilidad del detalle de eventos: full (grado-evento, prod), partial (reservado), none (solo marcador, volcado histórico). La UI/API usa esto para no enseñar timeline en partidos sin detalle. Ver migración 048.';

-- ── 2. import_batches ───────────────────────────────────────────────────────
-- Un registro por corrida del volcado. Da trazabilidad ("qué entró, cuándo,
-- con qué alcance") y, sobre todo, reversibilidad: revertir = borrar los
-- matches con ese import_batch_id (y marcar status='reverted'), sin tocar prod.
CREATE TABLE IF NOT EXISTS import_batches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id   uuid REFERENCES data_sources(id),
  label       text NOT NULL UNIQUE,               -- p. ej. 'hist-okliga-m-2017-2024'
  kind        text NOT NULL DEFAULT 'historic',
  status      text NOT NULL DEFAULT 'running',     -- running | completed | reverted
  scope_note  text,                                -- alcance humano del lote
  stats       jsonb NOT NULL DEFAULT '{}'::jsonb,  -- conteos: {matches, teams_new, seasons_new, ...}
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT import_batches_kind_check   CHECK (kind   IN ('historic', 'backfill', 'manual')),
  CONSTRAINT import_batches_status_check CHECK (status IN ('running', 'completed', 'reverted'))
);

COMMENT ON TABLE import_batches IS
  'Corridas del volcado histórico. Cada fila importada apunta aquí por import_batch_id. Revertir un lote = borrar sus matches y poner status=reverted. Ver migración 048 y docs del volcado.';

-- ── 3. matches.import_batch_id ──────────────────────────────────────────────
-- NULL = fila nativa de prod (scraper). No-NULL = vino de un lote del volcado.
ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS import_batch_id uuid REFERENCES import_batches(id);

-- Índice parcial: solo interesa filtrar/purgar las filas del volcado, que son
-- minoría frente a las nativas (que tienen import_batch_id NULL).
CREATE INDEX IF NOT EXISTS idx_matches_import_batch
  ON matches(import_batch_id)
  WHERE import_batch_id IS NOT NULL;

COMMENT ON COLUMN matches.import_batch_id IS
  'Lote del volcado que creó esta fila (import_batches.id). NULL = partido nativo de prod. Ver migración 048.';

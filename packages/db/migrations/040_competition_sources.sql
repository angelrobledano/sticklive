-- ============================================================
-- 040 — Tabla competition_sources: configuración de scraping por competición.
--
-- Punto 10 de AUDITORIA_ARQUITECTURA_2026-07-19.md, Fase 1 (fundación).
--
-- Hoy, dar de alta una competición para el scraping periódico exige tocar
-- CÓDIGO: `run-pipeline.ts` tiene hardcodeados el idc por defecto
-- (IDC_OK_LIGA='3150'), qué idc son playoff (PLAYOFF_IDCS_PIPELINE) y cuáles
-- copa (CUP_IDCS), más el mapa de nombres. World Skate ya es data-driven
-- (`resolveWorldskate` lee la BD); la deuda está toda en el lado FEP.
--
-- Esta tabla mueve esa configuración a DATOS: una fila por competición con su
-- fuente, sus identificadores externos y su política de sondeo. El objetivo
-- final (Fase 3) es que "dar de alta una competición" sea un INSERT, sin
-- rebuild ni redeploy.
--
-- ── Modelo ──────────────────────────────────────────────────────────────────
--
-- Una fila POR COMPETICIÓN (no por idc). El playoff de la OK Liga (idc 3481)
-- NO es una competición aparte: las migraciones 014/026 lo fusionaron como
-- round_type='playoff' dentro de la temporada de la liga. Por eso sus idc son
-- FUENTES SECUNDARIAS que alimentan a la liga, y viven en external_ids:
--
--   external_ids = {"idc": "3150", "playoff_idcs": ["3481"], "cup_idcs": []}
--
-- poll_policy gobierna los intervalos (Fase 3); nullable de momento, con los
-- valores por defecto que hoy son constantes en cron-live.
--
-- ── Fase 1: additiva y muerta ───────────────────────────────────────────────
--
-- NADIE lee esta tabla todavía. Se crea, se siembra (seed aparte) y se verifica;
-- el runtime sigue usando las constantes hasta la Fase 2. Cero riesgo.
-- ============================================================

CREATE TABLE IF NOT EXISTS competition_sources (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id  UUID NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  source_id       UUID NOT NULL REFERENCES data_sources(id),
  -- Identificadores en la fuente. Forma:
  --   {"idc": "3150", "playoff_idcs": ["3481"], "cup_idcs": []}
  external_ids    JSONB NOT NULL,
  -- Política de sondeo en directo. NULL = usar los defaults de cron-live.
  --   {"liveIntervalS": 45, "windowHours": 2}
  poll_policy     JSONB,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Una configuración por competición (la lista de idcs va dentro de external_ids).
  UNIQUE (competition_id)
);

CREATE INDEX IF NOT EXISTS idx_competition_sources_active
  ON competition_sources(is_active) WHERE is_active = TRUE;

COMMENT ON TABLE competition_sources IS
  'Configuración de scraping por competición (punto 10). Una fila por competición; los idc secundarios (playoff/copa) van en external_ids. Fase 1: additiva, aún no la lee el runtime.';

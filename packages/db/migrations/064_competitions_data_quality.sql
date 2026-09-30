-- ============================================================
-- 064 — Flag de calidad de datos por competición (#230).
--
-- Etiqueta el nivel de confianza del histórico de cada competición:
--   'ok'          defecto.
--   'en_revision' el contenido (o parte) viene de import sin verificar
--                 contra la fuente: la web lo ETIQUETA (no lo oculta) para
--                 que el usuario sepa qué está mirando.
--
-- Regla de flujo: el enrich/re-fichas (campañas #232/#226) promueve a 'ok'
-- cuando su verificación pase; nada baja a 'en_revision' automáticamente
-- (el detector es el check diario #231).
-- ============================================================

ALTER TABLE competitions
  ADD COLUMN IF NOT EXISTS data_quality TEXT NOT NULL DEFAULT 'ok'
    CHECK (data_quality IN ('ok', 'en_revision'));

COMMENT ON COLUMN competitions.data_quality IS
  'Nivel de confianza del histórico (#230): ok | en_revision. La web etiqueta (no oculta) las competiciones en revisión; las campañas de verificación las promueven a ok.';

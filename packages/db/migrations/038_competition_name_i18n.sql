-- ============================================================
-- 038 — Nombres de competición multilingües (competitions.name_i18n).
--
-- Punto 9 / 3.1 de AUDITORIA_ARQUITECTURA_2026-07-19.md (i18n de DATOS).
--
-- `competitions.name` es texto libre en español ("OK Liga", "Campeonato de
-- Europa Sub-17 Masculino"). Hoy no molesta porque todas las competiciones son
-- españolas, pero el día que entre una liga extranjera un usuario italiano
-- leería el nombre en español. Esta columna guarda las traducciones.
--
-- Additiva y sin riesgo:
--   · NULLABLE a propósito. Los loaders siguen escribiendo sólo `name`; las
--     filas nuevas quedan con name_i18n NULL y la web cae a `name`. No hace
--     falta tocar el pipeline de scraping.
--   · Se backfillea lo existente a {"es": name} por consistencia, para que
--     quien añada una traducción parta de un objeto y no de NULL.
--   · `name` se queda como fallback canónico; NO se elimina.
--
-- Cuando entre una competición que merezca traducción, se rellena name_i18n
-- (seed o admin) con {"es": "...", "en": "...", ...}. La web elige
-- name_i18n[locale] ?? name.
--
-- NOTA: la limpieza de la columna muerta `players.position` (punto 9) NO va
-- aquí. Aunque no la escribe ningún loader, la API la usa en un ORDER BY que
-- coloca a los porteros primero en la plantilla; quitarla bien implica derivar
-- ese "porteros primero" de match_lineups.is_goalkeeper, que es un cambio
-- aparte. Va en su propio PR para no mezclarlo con esto.
-- ============================================================

ALTER TABLE competitions ADD COLUMN IF NOT EXISTS name_i18n JSONB;

UPDATE competitions
   SET name_i18n = jsonb_build_object('es', name)
 WHERE name_i18n IS NULL;

COMMENT ON COLUMN competitions.name_i18n IS
  'Traducciones del nombre por locale ({"es":"OK Liga","en":"..."}). NULL permitido; la web cae a competitions.name. Backfill inicial: {"es": name}. Rellenar al alta de competiciones que merezcan traducción.';

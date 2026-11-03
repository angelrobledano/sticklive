-- ============================================================
-- 105 — Nivel (tier) para el resto del catálogo
--
-- Problema (home 03/11/2026): un día sin destacadas, «Otras competiciones»
-- salía casi en orden alfabético porque solo las destacadas y unas pocas
-- ligas nacionales tenían `tier`. La Primera Catalana quedaba por debajo de
-- un Juvenil o de una liga de veteranos.
--
-- Escala para lo NO destacado (las destacadas ya tienen 1-3 en 089/100):
--   4  sénior autonómica de la federación con más volumen y seguimiento
--      (FECAPA: Primera Catalana masc./fem.)
--   5  resto de ligas sénior (autonómicas, Segona Catalana, etc.)
--   6  júnior / juvenil / sub-19 a sub-23
--   7  resto de base (infantil, alevín, sub-15/17, cadete)
--   8  veteranos
--   9  benjamín, prebenjamín, escuelas
--
-- `tier` solo da visibilidad en el feed cuando vale 1 y la competición es
-- destacada (`feedReason`), así que esto ordena y nada más. Las copas no
-- tienen tier por diseño (100).
--
-- Idempotente y conservadora: solo toca lo que está a NULL y no es
-- destacada, así que no pisa ediciones del admin.
-- ============================================================

UPDATE competitions SET tier = CASE
    WHEN age_category = 'veteranos' OR name ~* 'VETERAN' THEN 8
    WHEN age_category IN ('benjamin', 'prebenjamin')
      OR name ~* 'BENJAM|ESCOL|ESCUEL|MINI' THEN 9
    WHEN age_category IN ('alevin', 'infantil')
      OR name ~* 'INFANTIL|ALEV|CADET|SUB-?\s?1[3-7]|U-?\s?1[3-7]|UNDER\s?1[3-7]' THEN 7
    WHEN age_category IN ('juvenil', 'junior', 'base')
      OR name ~* 'JUVENIL|J[UÚ]NIOR|JUNIORES|GIOVANIL|SUB-?\s?(19|20|23)|U-?\s?(19|20|23)|UNDER\s?(19|20|23)' THEN 6
    WHEN organizer = 'FECAPA' AND name ~* 'PRIMERA|1[ªa.]' THEN 4
    WHEN age_category = 'senior' THEN 5
    ELSE 7
  END
WHERE tier IS NULL
  AND featured_rank IS NULL
  AND name !~* 'COPA|COPPA|TA[ÇC]A|SUPERCOP|SUPERTA|TROFEO|TROFEU|TORNEIG|TORNEO|CUP';

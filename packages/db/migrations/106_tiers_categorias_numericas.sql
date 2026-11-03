-- ============================================================
-- 106 — Categorías de base escritas con número (auditoría UX 03/11/2026, #13)
--
-- La 105 dejaba en tier 5 (sénior) ligas como «Femení 13 OR»: FECAPA nombra
-- algunas categorías de base por edad («13», «15», «17») y `age_category`
-- llega como 'senior'. Edad 10-17 → tier 7 (base). Solo toca lo que la 105
-- puso en 5 y no es destacada: no pisa ediciones del admin a otros valores.
-- Idempotente.
-- ============================================================

UPDATE competitions SET tier = 7
WHERE tier = 5
  AND featured_rank IS NULL
  AND name ~* '\m1[0-7]\M';

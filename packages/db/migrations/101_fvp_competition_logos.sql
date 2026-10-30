-- ============================================================
-- 101 — Logo de las competiciones vascas (FVP)
--
-- La API de la FVP no publica logo de competición; seed-fvp usa el escudo de
-- la federación (apps/web/public/federaciones/fvp.png), pero las 15
-- competiciones se dieron de alta antes y el seed solo rellena si falta
-- (COALESCE). Se rellena aquí. Idempotente: no pisa un logo puesto a mano.
-- ============================================================
UPDATE competitions
   SET logo_url = 'https://sticklive.eu/federaciones/fvp.png', updated_at = NOW()
 WHERE organizer = 'FVP' AND logo_url IS NULL;

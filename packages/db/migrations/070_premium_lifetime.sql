-- 070_premium_lifetime.sql
-- Monetización: compra única "para siempre" vendida por Stripe en la web
-- (pago único → webhook → premium_lifetime=TRUE). El guard autoritativo pasa
-- a ser:
--   premium_lifetime OR premium_until > NOW()
-- (auditoría S9: is_premium nunca se revierte y NO es fuente de verdad).
--
-- NOTA: NULL/FALSE = no lifetime. NO cambia la semántica de premium_until:
-- los usuarios gratis ya tienen NULL, y la compra anual sigue extendiéndolo.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS premium_lifetime BOOLEAN NOT NULL DEFAULT FALSE;

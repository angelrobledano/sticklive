-- ============================================================
-- 095 — País preferido del usuario (plan home 2026-10-25, iteración 4)
--
-- Ordena la home (sus competiciones primero) sin excluir nada. Aditiva:
-- NULL = sin preferencia. Los anónimos lo guardan solo en su navegador.
-- ============================================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_country TEXT
  CHECK (preferred_country IS NULL OR preferred_country ~ '^[A-Z]{2}$');

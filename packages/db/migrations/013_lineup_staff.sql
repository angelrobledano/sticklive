-- ============================================================
-- Migración 013: cuerpo técnico en las alineaciones
-- El acta lista al staff al pie de cada plantilla con códigos de rol:
--   E1/E2 = entrenador / 2º entrenador · A = auxiliar · D = delegado
-- role NULL = jugador (filas existentes).
-- ============================================================

ALTER TABLE match_lineups ADD COLUMN IF NOT EXISTS role TEXT;

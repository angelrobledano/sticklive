-- ============================================================
-- Migración 020: seguir jugadores (tercer tipo de favorito)
-- ============================================================

ALTER TABLE user_favorites DROP CONSTRAINT IF EXISTS user_favorites_kind_check;
ALTER TABLE user_favorites ADD CONSTRAINT user_favorites_kind_check
  CHECK (kind IN ('team', 'league', 'player'));

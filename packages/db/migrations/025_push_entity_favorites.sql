-- ============================================================
-- Migración 025: favoritos por entidad en las suscripciones push
--
-- Permite segmentar las notificaciones por competición y por jugador
-- (además de por equipo, que ya existía en fav_teams). El cliente envía
-- las listas de entidades con notificación ACTIVADA.
-- ============================================================

ALTER TABLE push_subscriptions
  ADD COLUMN IF NOT EXISTS fav_leagues UUID[] NOT NULL DEFAULT '{}';

ALTER TABLE push_subscriptions
  ADD COLUMN IF NOT EXISTS fav_players UUID[] NOT NULL DEFAULT '{}';

-- ============================================================
-- Migración 012: foto del jugador
-- Patrón descubierto con fep-player-photo-probe.ts (2026-06-10):
--   https://sidgad.cloud/rfep/images/fichas/{id_player}_1.jpg
-- ============================================================

ALTER TABLE players ADD COLUMN IF NOT EXISTS photo_url TEXT;

-- Backfill para los jugadores ya creados (source_ref = fep_player_{id})
UPDATE players
SET photo_url = 'https://sidgad.cloud/rfep/images/fichas/' || REPLACE(source_ref, 'fep_player_', '') || '_1.jpg'
WHERE source_ref LIKE 'fep_player_%' AND photo_url IS NULL;

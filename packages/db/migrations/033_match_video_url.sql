-- ============================================================
-- Migración 033: enlace de vídeo por partido
--
-- World Skate publica un enlace de vídeo (europe.worldskate.tv) por partido,
-- un extra que la FEP no da. Se guarda en matches.video_url (nullable).
-- ============================================================

ALTER TABLE matches ADD COLUMN IF NOT EXISTS video_url TEXT;

COMMENT ON COLUMN matches.video_url IS
  'Enlace de vídeo del partido si la fuente lo publica (ej: World Skate → europe.worldskate.tv). NULL si no hay.';

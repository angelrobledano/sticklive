-- ============================================================
-- 091 — Slugs antiguos de club (Plan B1, ficha /clubs/<slug>)
--
-- El slug del club es su URL pública. Al renombrarlo desde /admin, el slug
-- anterior se guarda aquí para que GET /clubs/:key lo resuelva y la web
-- responda 308 al nuevo: las URLs indexadas o compartidas no se rompen.
-- Estrictamente aditiva.
-- ============================================================
CREATE TABLE IF NOT EXISTS club_slug_redirects (
  old_slug   TEXT PRIMARY KEY,
  club_id    UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_club_slug_redirects_club ON club_slug_redirects(club_id);

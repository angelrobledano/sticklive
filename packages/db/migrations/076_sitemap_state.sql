-- ============================================================
-- 076 — Última generación del sitemap (F1-8 de la auditoría SEO).
--
-- El sitemap ya responde 503 si la API falla (nunca uno degradado), pero una
-- caída silenciosa de las URLs elegibles (p. ej. un ETL que oculta temporadas)
-- pasaba desapercibida. `/meta/sitemap` guarda aquí el total de la última
-- generación; si el nuevo cae más del 20 %, se emite un evento a Sentry.
--
-- Una sola fila: `id` es TRUE por CHECK, así que el upsert siempre cae en la
-- misma. `sections` guarda el desglose por tipo para diagnosticar la caída.
--
-- Idempotente y aditiva.
-- ============================================================

CREATE TABLE IF NOT EXISTS sitemap_state (
  id          BOOLEAN     PRIMARY KEY DEFAULT TRUE CHECK (id),
  total       INTEGER     NOT NULL CHECK (total >= 0),
  sections    JSONB       NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE sitemap_state IS
  'Última generación de /meta/sitemap: total y desglose por tipo. Base de la alerta de caída > 20 % (F1-8).';

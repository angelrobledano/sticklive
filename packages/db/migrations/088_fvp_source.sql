-- ============================================================
-- 088 — Fuente FVP (Federación Vasca de Patinaje)
--
-- fvpatinaje.eus corre sobre DigitalSport, con una API pública en JSON
-- (/api/public/..., /api/hierarchy/...). No es sidgad (provider 'digitalsport').
-- Publica en hora local peninsular (Europe/Madrid). Incluye la Liga Norte
-- (interterritorial: equipos de Euskadi, Navarra, Cantabria y Burgos).
--
-- Solo registra la fuente. Competiciones, temporadas y equipos los crea
-- apps/etl/src/seed-fvp.ts (dry-run por defecto). Aditiva e idempotente.
-- ============================================================

INSERT INTO data_sources
  (name, base_url, scraper_key, provider, portal_prefix, request_base_url, referer, logo_base, default_timezone, notes)
VALUES
  ('Federación Vasca de Patinaje - Hockey Patines',
   'https://www.fvpatinaje.eus/comp/hp',
   'fvp_hockey',
   'digitalsport',
   'fvp',
   'https://www.fvpatinaje.eus/api',
   'https://www.fvpatinaje.eus/',
   'https://digitalsport-public-docs.s3.fr-par.scw.cloud/',
   'Europe/Madrid',
   'Ligas y copas de Euskadi + Liga Norte. API JSON de DigitalSport: catálogo /public/entity/{entidad}/competitions, árbol /hierarchy/division/{id}/tree, clasificación /hierarchy/fase/{id}/clasificacion, acta /public/partidos/{id}.')
ON CONFLICT (scraper_key) DO UPDATE SET
  name             = EXCLUDED.name,
  base_url         = EXCLUDED.base_url,
  provider         = EXCLUDED.provider,
  portal_prefix    = EXCLUDED.portal_prefix,
  request_base_url = EXCLUDED.request_base_url,
  referer          = EXCLUDED.referer,
  logo_base        = EXCLUDED.logo_base,
  default_timezone = EXCLUDED.default_timezone,
  notes            = EXCLUDED.notes,
  updated_at       = NOW();

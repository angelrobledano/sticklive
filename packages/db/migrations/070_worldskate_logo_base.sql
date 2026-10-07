-- ============================================================
-- 070 — logo_base del portal worldskate apunta al CDN válido
--
-- Los ficheros de escudo/bandera de los torneos actuales (WSG Asunción
-- 2026) NO existen bajo www.sidgad.com — solo en sidgad.cloud. Con la
-- base antigua, el cargador de clasificaciones reescribía teams.logo_url
-- a URLs 404 en cada scrape y download-logos fallaba ("fallo al
-- descargar escudo") para todas las selecciones.
--
-- La columna no la consume ningún código en runtime (los seeds definen
-- su propia constante), pero es la referencia documental de la fuente.
-- ============================================================

UPDATE data_sources
SET logo_base = 'https://sidgad.cloud/worldskate/images/logos_clubes/',
    updated_at = NOW()
WHERE scraper_key = 'worldskate_hockey'
  AND logo_base <> 'https://sidgad.cloud/worldskate/images/logos_clubes/';

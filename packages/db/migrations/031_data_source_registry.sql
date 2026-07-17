-- ============================================================
-- Migración 031: data_sources como registro de fuentes
--
-- Mueve a datos la configuración por-fuente que hoy vive en código/env
-- (BASE_URL, prefijo de portal sidgad, Referer, zona horaria). Es la base
-- de la arquitectura multi-fuente: un único orquestador itera sobre
-- data_sources en vez de un scraper por federación con env global.
--
-- Proveedor actual: 'sidgad' (misma plataforma para FEP, autonómicas y
-- World Skate Europe; cambia el prefijo de portal y el dominio base).
-- ============================================================

ALTER TABLE data_sources ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'sidgad';
ALTER TABLE data_sources ADD COLUMN IF NOT EXISTS portal_prefix TEXT;      -- 'rfep' | 'worldskate' | 'fmp' ...
ALTER TABLE data_sources ADD COLUMN IF NOT EXISTS request_base_url TEXT;   -- base de los endpoints PHP (distinta de base_url, que es el portal público)
ALTER TABLE data_sources ADD COLUMN IF NOT EXISTS referer TEXT;
ALTER TABLE data_sources ADD COLUMN IF NOT EXISTS logo_base TEXT;
ALTER TABLE data_sources ADD COLUMN IF NOT EXISTS default_timezone TEXT NOT NULL DEFAULT 'Europe/Madrid';

-- ── Backfill de la fuente FEP existente (comportamiento actual, sin cambios) ──
-- Valores tomados de sidgad-client.ts (SIDGAD_PORTAL por defecto 'rfep',
-- BASE_URL server2.sidgad.es/rfep, REFERER hockeypatines.fep.es).
UPDATE data_sources SET
  provider         = 'sidgad',
  portal_prefix    = 'rfep',
  request_base_url = 'https://www.server2.sidgad.es/rfep',
  referer          = 'https://www.hockeypatines.fep.es/',
  logo_base        = 'https://www.sidgad.com/rfep/images/logos_clubes/',
  default_timezone = 'Europe/Madrid'
WHERE scraper_key = 'fep_hockey';

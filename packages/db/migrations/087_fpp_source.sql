-- ============================================================
-- 087 — Fuente FPP (Federação de Patinagem de Portugal)
--
-- Primera fuente que NO es sidgad: hp.fpp.pt es un PHP propio renderizado en
-- servidor (provider 'fpp'). Publica en hora LOCAL de Portugal continental,
-- por eso default_timezone = Europe/Lisbon (las competiciones lo llevan
-- además en competitions.timezone; ver project_ligas_pt_it_hora_local).
--
-- Solo registra la fuente. Las competiciones, temporadas y equipos los crea
-- apps/etl/src/seed-fpp.ts (dry-run por defecto). Aditiva e idempotente.
-- ============================================================

INSERT INTO data_sources
  (name, base_url, scraper_key, provider, portal_prefix, request_base_url, referer, logo_base, default_timezone, notes)
VALUES
  ('Federação de Patinagem de Portugal - Hóquei em Patins',
   'https://hp.fpp.pt',
   'fpp_hockey',
   'fpp',
   'fpp',
   'https://hp.fpp.pt',
   'https://hp.fpp.pt/',
   'https://plataforma.fpp.pt/Files/',
   'Europe/Lisbon',
   'Ligas y copas de Portugal. Web propia (no sidgad): /Competicao/{id}, /Classificacao/{id}, /jogo/{id}. Un id por fase y zona; el catálogo los agrupa (apps/scraper/src/scrapers/fpp/fpp-catalog.ts).')
ON CONFLICT (scraper_key) DO UPDATE SET
  name             = EXCLUDED.name,
  provider         = EXCLUDED.provider,
  portal_prefix    = EXCLUDED.portal_prefix,
  request_base_url = EXCLUDED.request_base_url,
  referer          = EXCLUDED.referer,
  logo_base        = EXCLUDED.logo_base,
  default_timezone = EXCLUDED.default_timezone,
  notes            = EXCLUDED.notes,
  updated_at       = NOW();

-- ── Categoría Sub-23 ─────────────────────────────────────────
-- Portugal tiene un Campeonato Nacional Sub-23. La competición y sus equipos
-- deben llevar la MISMA categoría: el resolver (#194) descarta un equipo cuya
-- age_category contradice la de la competición, y con 'base' en la
-- competición y 'sub23' en el equipo la clasificación no cargaba. La web ya
-- pinta 'sub23' como "Sub-23" (team-section-label).
ALTER TABLE competitions DROP CONSTRAINT IF EXISTS competitions_age_category_check;
ALTER TABLE competitions ADD CONSTRAINT competitions_age_category_check
  CHECK (age_category IN ('senior','juvenil','junior','infantil','alevin','benjamin','prebenjamin','veteranos','base','sub23'));

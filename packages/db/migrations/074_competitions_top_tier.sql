-- ============================================================
-- 074 — Competiciones de máxima categoría (`top_tier`), F1-3/F1-4.
--
-- Decisión de producto (17/10/2026): se indexan las fichas de jugador de las
-- competiciones más importantes y de máxima categoría. Hasta ahora el sitemap
-- declaraba a cualquier jugador con una alineación (1.667 fichas de ~85
-- palabras, el 55 % del sitemap). Ver docs/AUDITORIA_SEO_2026-10-16.md (§6).
--
-- Es un dato de la competición y no una lista en el código porque van a entrar
-- ligas de Portugal e Italia desde otras fuentes: marcar su primera división es
-- un UPDATE (o el panel de admin), no un despliegue.
--
-- Backfill por slug: primera división española masculina y femenina, sus copas
-- y supercopas, y los torneos absolutos de los World Skate Games. Quedan fuera
-- Plata, Bronce, Copa SAR la Princesa y las categorías de formación (Sub-19).
--
-- Idempotente y aditiva.
-- ============================================================

ALTER TABLE competitions
  ADD COLUMN IF NOT EXISTS top_tier BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN competitions.top_tier IS
  'Competición de máxima categoría: sus jugadores se declaran en el sitemap (F1-3/F1-4). Ver migración 074.';

UPDATE competitions
   SET top_tier = TRUE
 WHERE top_tier = FALSE
   AND slug IN (
     'ok-liga-masculina',
     'ok-liga-femenina',
     'copa-del-rey',
     'copa-de-la-reina-iberdrola',
     'supercopa-de-espana-masculina',
     'supercopa-de-espana-femenina',
     'mundial-masculino-worldskate',
     'mundial-femenino-worldskate',
     'intercontinental-masculino-worldskate'
   );

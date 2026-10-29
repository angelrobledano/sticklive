-- ============================================================
-- 098 — Clubes asturianos que faltaban y restos de «DESCANSO»
--
-- Revisión de equipos sin club (29/10/2026): Asturhockey CP, CP Areces y
-- CP Cuencas Mineras no existían como club y sus equipos quedaban sueltos.
-- Se crean vacíos; los equipos se cuelgan desde el panel (PATCH
-- /admin/teams/:id/club). Además se borran los clubes «DESCANSO 1/2» que
-- quedaron sin equipos tras la 097 (sus equipos no apuntaban a ellos).
-- Idempotente.
-- ============================================================
INSERT INTO clubs (sport_id, canonical_name, slug, region, country)
SELECT s.id, v.name, v.slug, 'Asturias', 'ES'
  FROM sports s
 CROSS JOIN (VALUES
   ('Asturhockey CP', 'asturhockey-cp'),
   ('CP Areces', 'cp-areces'),
   ('CP Cuencas Mineras', 'cp-cuencas-mineras')
 ) AS v(name, slug)
 WHERE s.slug = 'hockey-patines'
ON CONFLICT (sport_id, slug) DO NOTHING;

DELETE FROM clubs c
 WHERE c.canonical_name ~* '^\s*descanso(\s+[0-9]+)?\s*$'
   AND NOT EXISTS (SELECT 1 FROM teams t WHERE t.club_id = c.id);

-- ============================================================
-- 099 — CP Vilanova la Daurada es un club propio (Lleida)
--
-- No es el CP Vilanova (Vilanova i la Geltrú, Barcelona). El 29/10/2026 se
-- resolvió por error el nombre «CP VILANOVA LA DAURADA» de la cola contra un
-- equipo del CP Vilanova, y sus equipos colgaban de ese club. Aquí:
--   · se crea el club CP Vilanova la Daurada;
--   · sus equipos (por nombre) pasan a ese club;
--   · se deshace lo aprendido que apuntaba a equipos que no son de La Daurada
--     (alias y mapa de fuente) y el ítem vuelve a la cola, para crearle
--     equipo desde el panel.
-- Idempotente.
-- ============================================================
INSERT INTO clubs (sport_id, canonical_name, slug, region, country)
SELECT s.id, 'CP Vilanova la Daurada', 'cp-vilanova-la-daurada', 'Lleida', 'ES'
  FROM sports s WHERE s.slug = 'hockey-patines'
ON CONFLICT (sport_id, slug) DO NOTHING;

UPDATE teams t
   SET club_id = c.id, updated_at = NOW()
  FROM clubs c
 WHERE c.slug = 'cp-vilanova-la-daurada' AND c.sport_id = t.sport_id
   AND t.name ~* 'vilanova\s+(de\s+)?la\s+daurada'
   AND t.club_id IS DISTINCT FROM c.id;

DELETE FROM team_aliases a
 USING teams t
 WHERE t.id = a.team_id
   AND a.raw_text ~* 'vilanova\s+(de\s+)?la\s+daurada'
   AND t.name !~* 'daurada';

DELETE FROM source_entity_map m
 USING resolution_queue q, teams t
 WHERE q.raw_text ~* 'vilanova\s+(de\s+)?la\s+daurada'
   AND q.source_ref IS NOT NULL
   AND m.source_id = q.source_id AND m.source_ref = q.source_ref
   AND t.id = m.team_id AND t.name !~* 'daurada';

UPDATE resolution_queue q
   SET status = 'pending', resolved_team_id = NULL, updated_at = NOW()
  FROM teams t
 WHERE t.id = q.resolved_team_id
   AND q.raw_text ~* 'vilanova\s+(de\s+)?la\s+daurada'
   AND t.name !~* 'daurada';

-- ============================================================
-- 094 — Letra de equipo duplicada («CLUB PATI CUBELLES B B» → «… B»)
--
-- FECAPA publica a veces la letra del equipo dos veces en categorías de base.
-- Desde ahora se colapsa al leerla (collapseRepeatedTeamLetter). Aquí se
-- limpian los equipos ya creados y las entradas pendientes de la cola, que
-- volverán a entrar con el nombre limpio si siguen sin resolverse.
-- ============================================================
UPDATE teams
   SET name = regexp_replace(name, '\s+([A-H])\s+\1\s*$', ' \1'),
       updated_at = NOW()
 WHERE name ~ '\s([A-H])\s+\1\s*$';

UPDATE clubs
   SET canonical_name = regexp_replace(canonical_name, '\s+([A-H])\s+\1\s*$', ''),
       updated_at = NOW()
 WHERE canonical_name ~ '\s([A-H])\s+\1\s*$';

DELETE FROM resolution_queue
 WHERE status = 'pending'
   AND raw_text ~ '\s([A-H])\s+\1\s*$';

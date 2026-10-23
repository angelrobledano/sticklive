-- ============================================================
-- 091 — Club de Arenys de Mar mal nombrado + Maristes con su escudo
--
-- El grupo de escudo fecapa_club_231 es el CH Arenys de Mar (8 equipos), pero
-- el club se creó con el nombre de «CHAM MARISTES-SAGRERENC», cuya ficha tenía
-- por error el escudo de Arenys (logos_clubes/231). Se renombra el club y se
-- quita el escudo equivocado a Maristes (el scraper lo rellena si falta).
-- ============================================================
UPDATE clubs c
   SET canonical_name = 'CH Arenys de Mar',
       slug           = 'ch-arenys-de-mar',
       updated_at     = NOW()
 WHERE c.canonical_name ILIKE '%MARISTES%SAGRERENC%'
   AND EXISTS (SELECT 1 FROM teams t WHERE t.club_id = c.id AND t.name ILIKE '%ARENYS DE MAR%')
   AND NOT EXISTS (SELECT 1 FROM clubs o WHERE o.sport_id = c.sport_id AND o.slug = 'ch-arenys-de-mar');

UPDATE club_names cn
   SET commercial_name = 'CLUB HOQUEI ARENYS DE MAR'
  FROM clubs c
 WHERE cn.club_id = c.id
   AND c.slug = 'ch-arenys-de-mar'
   AND cn.commercial_name ILIKE '%MARISTES%SAGRERENC%'
   AND NOT EXISTS (SELECT 1 FROM club_names x WHERE x.club_id = c.id
                    AND x.commercial_name = 'CLUB HOQUEI ARENYS DE MAR' AND x.valid_from = cn.valid_from);

UPDATE teams
   SET logo_url = NULL, updated_at = NOW()
 WHERE name ILIKE '%MARISTES%SAGRERENC%'
   AND logo_url ~ '/logos_clubes/231\.';

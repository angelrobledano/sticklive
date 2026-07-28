-- 041 · Limpieza de group_name genéricos en standings
--
-- El scraper FEP tomaba el título de la cabecera de la tabla como nombre de
-- grupo, y un filtro que comparaba sin normalizar tildes ('CLASIFICACIÓN' !==
-- 'CLASIFICACION') dejaba colar el título GENÉRICO como si fuera un grupo. Las
-- ligas son de tabla única: no tienen grupos. En la web, ese group_name espurio
-- activaba el modo "agrupado" (encabezado "Grupo CLASIFICACIÓN") y hacía perder
-- las zonas de playoff/descenso.
--
-- El fix del scraper (isGenericStandingsTitle) evita que se vuelva a guardar,
-- pero NO corrige lo ya cargado: group_name forma parte de la clave del upsert
-- (season_id, team_id, COALESCE(group_name,'')), así que un re-scrape con NULL
-- crearía filas duplicadas en vez de corregir. Hay que limpiarlo aquí.
--
-- `translate` quita los diacríticos de forma portable (sin depender de la
-- extensión unaccent). Sólo toca títulos genéricos; los grupos reales
-- ("GRUPO A") se conservan. Va antes que el etl (servicio migrate), así el
-- siguiente scrape ya no duplica.

UPDATE standings
SET group_name = NULL,
    updated_at = NOW()
WHERE group_name IS NOT NULL
  AND upper(translate(
        group_name,
        'ÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÇáàäâãéèëêíìïîóòöôõúùüûç',
        'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc'
      )) IN ('CLASIFICACION', 'CLASSIFICACIO', 'CLASSIFICACION', 'STANDINGS', 'CLASSIFICATION');

-- ============================================================
-- 081 — Espacio de nombres por portal sidgad en las refs (A1)
--
-- Cada portal sidgad (RFEP, FECAPA, World Skate, federaciones autonómicas)
-- numera a sus jugadores, partidos y competiciones por separado. Hasta ahora
-- todas las actas producían `fep_player_{id}` y FECAPA se cargó con
-- `fep_match_` y un idc sin prefijo, así que dos personas distintas acababan
-- en la MISMA fila de `players` (Pol Galbas, de OK Liga, "jugaba" el Mundial
-- Sub-19 con Italia). Ver docs/ANALISIS_OKMOB_MODELO_DATOS_2026-10-22.md §5.3.
--
-- El código ya emite refs con el portal (`fecapa_player_`, `wse_player_`…).
-- Esta migración renombra lo YA cargado que pertenece sin duda a UN portal
-- distinto de RFEP:
--   · competiciones de ese portal: idc → `{portal}_competition_{idc}`,
--   · partidos `fep_match_` de esas competiciones → `{portal}_match_`,
--   · `match_lineups.player_source_ref` por el portal del partido,
--   · jugadores cuyas apariciones son TODAS de un único portal no RFEP.
--
-- RFEP conserva `fep_` en todo. Los jugadores con apariciones en VARIOS
-- portales no se tocan: son fusiones de personas distintas y las separa
-- `apps/etl/src/split-merged-players.ts` (A2), que necesita revisión.
--
-- Reescribe datos: hacer `./deploy/backup-db.sh` antes. Idempotente: la
-- función se puede volver a ejecutar (`SELECT * FROM apply_portal_namespacing()`).
-- ============================================================

CREATE OR REPLACE FUNCTION competition_portal_key(p_organizer TEXT, p_source_ref TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_source_ref ~ '^[a-z]+_competition_' THEN split_part(p_source_ref, '_competition_', 1)
    WHEN p_organizer ILIKE 'world skate%'      THEN 'wse'
    WHEN upper(p_organizer) = 'FECAPA'         THEN 'fecapa'
    WHEN upper(p_organizer) = 'FMP'            THEN 'fmp'
    WHEN upper(p_organizer) = 'FAP'            THEN 'fap'
    WHEN upper(p_organizer) = 'FPCV'           THEN 'fpcv'
    WHEN upper(p_organizer) = 'FGP'            THEN 'fgp'
    ELSE 'fep'
  END
$$;

COMMENT ON FUNCTION competition_portal_key(TEXT, TEXT) IS
  'Clave de fuente (core/sources.ts) del portal sidgad de una competición: fep | wse | fecapa | fmp | fap | fpcv | fgp.';

CREATE OR REPLACE FUNCTION apply_portal_namespacing()
RETURNS TABLE (
  competitions_renamed INT,
  matches_renamed      INT,
  lineups_renamed      INT,
  players_renamed      INT,
  players_mixed        INT
)
LANGUAGE plpgsql AS $$
BEGIN
  DROP TABLE IF EXISTS _comp_portal, _match_portal, _player_portals;
  -- Portal de cada competición, antes de renombrar nada.
  CREATE TEMP TABLE _comp_portal ON COMMIT DROP AS
    SELECT c.id AS competition_id, competition_portal_key(c.organizer, c.source_ref) AS portal
      FROM competitions c;

  CREATE TEMP TABLE _match_portal ON COMMIT DROP AS
    SELECT m.id AS match_id, cp.portal
      FROM matches m
      JOIN seasons s       ON s.id = m.season_id
      JOIN _comp_portal cp ON cp.competition_id = s.competition_id;
  CREATE INDEX ON _match_portal (match_id);

  -- Portales en los que aparece cada jugador (plantilla, alineación, evento).
  CREATE TEMP TABLE _player_portals ON COMMIT DROP AS
    SELECT player_id, array_agg(DISTINCT portal) AS portals
      FROM (
        SELECT tp.player_id, cp.portal
          FROM team_players tp
          JOIN seasons s       ON s.id = tp.season_id
          JOIN _comp_portal cp ON cp.competition_id = s.competition_id
        UNION ALL
        SELECT ml.player_id, mp.portal
          FROM match_lineups ml JOIN _match_portal mp ON mp.match_id = ml.match_id
         WHERE ml.player_id IS NOT NULL
        UNION ALL
        SELECT e.player_id, mp.portal
          FROM match_events e JOIN _match_portal mp ON mp.match_id = e.match_id
         WHERE e.player_id IS NOT NULL
      ) x
     GROUP BY player_id;

  UPDATE competitions c
     SET source_ref = cp.portal || '_competition_' || c.source_ref, updated_at = NOW()
    FROM _comp_portal cp
   WHERE cp.competition_id = c.id
     AND cp.portal <> 'fep'
     AND c.source_ref ~ '^\d+$';
  GET DIAGNOSTICS competitions_renamed = ROW_COUNT;

  UPDATE matches m
     SET source_ref = mp.portal || '_match_' || substring(m.source_ref FROM '^fep_match_(.*)$')
    FROM _match_portal mp
   WHERE mp.match_id = m.id
     AND mp.portal <> 'fep'
     AND m.source_ref LIKE 'fep\_match\_%';
  GET DIAGNOSTICS matches_renamed = ROW_COUNT;

  UPDATE match_lineups ml
     SET player_source_ref = mp.portal || '_player_' || substring(ml.player_source_ref FROM '^fep_player_(.*)$')
    FROM _match_portal mp
   WHERE mp.match_id = ml.match_id
     AND mp.portal <> 'fep'
     AND ml.player_source_ref LIKE 'fep\_player\_%';
  GET DIAGNOSTICS lineups_renamed = ROW_COUNT;

  UPDATE players p
     SET source_ref = pp.portals[1] || '_player_' || substring(p.source_ref FROM '^fep_player_(.*)$'),
         updated_at = NOW()
    FROM _player_portals pp
   WHERE pp.player_id = p.id
     AND cardinality(pp.portals) = 1
     AND pp.portals[1] <> 'fep'
     AND p.source_ref LIKE 'fep\_player\_%';
  GET DIAGNOSTICS players_renamed = ROW_COUNT;

  SELECT count(*)::int INTO players_mixed
    FROM _player_portals pp
    JOIN players p ON p.id = pp.player_id
   WHERE cardinality(pp.portals) > 1
     AND p.source_ref LIKE 'fep\_player\_%';

  RETURN NEXT;
END
$$;

COMMENT ON FUNCTION apply_portal_namespacing() IS
  'A1: renombra a {portal}_ las refs ya cargadas de un único portal no RFEP. Idempotente. Los jugadores multi-portal los separa split-merged-players (A2).';

SELECT * FROM apply_portal_namespacing();

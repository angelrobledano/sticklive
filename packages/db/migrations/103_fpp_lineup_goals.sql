-- ============================================================
-- 103 — Goles en las alineaciones de la FPP (2/11/2026)
--
-- La ficha de la FPP no trae los goles en la alineación y los goleadores de la
-- temporada salen de match_lineups.goals: Elite Cup 2026/27 (y el resto de
-- Portugal) sin goleadores. El scraper ya los cuenta desde el timeline; esto
-- arregla lo ya cargado. Solo partidos FPP y solo filas con 0 goles.
-- Idempotente.
-- ============================================================

UPDATE match_lineups ml
   SET goals = g.n
  FROM (
    SELECT e.match_id, e.player_id, count(*)::int AS n
      FROM match_events e
      JOIN matches m ON m.id = e.match_id
     WHERE m.source_ref LIKE 'fpp\_%'
       AND e.event_type = 'goal'
       AND e.player_id IS NOT NULL
     GROUP BY e.match_id, e.player_id
  ) g
 WHERE ml.match_id = g.match_id
   AND ml.player_id = g.player_id
   AND COALESCE(ml.goals, 0) = 0;

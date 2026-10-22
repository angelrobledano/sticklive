-- ============================================================
-- 086 — Exhaustividad del acta reconciliada con el marcador (B5)
--
-- `matches.event_coverage` era 'full' en cuanto llegaba un acta con eventos,
-- aunque estuviera a medias (wse_match_3248: 0-6 con 0-2 en el acta). Ahora:
--   full    — terminado y los goles del acta suman el marcador,
--   partial — en juego, o terminado con el acta descuadrada, o sin marcador,
--   none    — sin eventos (volcado histórico): no se toca.
-- `partial` ya existía en el CHECK de la 048 ("reservado"). La web solo oculta
-- el timeline con 'none'; los insights solo usan 'full'.
--
-- Se recalcula desde la ficha (refreshEventCoverage) y, por trigger, cuando
-- cambian estado o marcador (el final del partido llega después del acta).
-- ============================================================

CREATE OR REPLACE FUNCTION refresh_event_coverage(p_match_id UUID) RETURNS VOID
LANGUAGE sql AS $$
  WITH c AS (
    SELECT m.id,
           CASE WHEN m.status = 'finished' AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
                 AND count(*) FILTER (WHERE e.event_type = 'goal' AND e.team_id = m.home_team_id) = m.home_score
                 AND count(*) FILTER (WHERE e.event_type = 'goal' AND e.team_id = m.away_team_id) = m.away_score
                THEN 'full' ELSE 'partial' END AS coverage
      FROM matches m
      JOIN match_events e ON e.match_id = m.id
     WHERE m.id = p_match_id
     GROUP BY m.id
  )
  UPDATE matches m SET event_coverage = c.coverage
    FROM c
   WHERE m.id = c.id AND m.event_coverage IS DISTINCT FROM c.coverage
$$;

CREATE OR REPLACE FUNCTION trg_refresh_event_coverage() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM refresh_event_coverage(NEW.id);
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS trg_matches_event_coverage ON matches;
CREATE TRIGGER trg_matches_event_coverage
  AFTER UPDATE OF status, home_score, away_score ON matches
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status
     OR OLD.home_score IS DISTINCT FROM NEW.home_score
     OR OLD.away_score IS DISTINCT FROM NEW.away_score)
  EXECUTE FUNCTION trg_refresh_event_coverage();

COMMENT ON FUNCTION refresh_event_coverage(UUID) IS
  'B5: event_coverage = full si el partido terminó y los goles del acta suman el marcador; partial si no. Sin eventos no toca.';

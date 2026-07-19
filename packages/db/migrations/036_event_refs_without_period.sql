-- ============================================================
-- 036 — Refs de contenido también para los eventos sin periodo.
--
-- La 035 exigía periodo Y crono para recomponer `source_ref`. Verificando en
-- producción apareció el caso que faltaba: eventos con crono y sin periodo.
--
--   fep_event_34249_45 | foul | period=NULL | clock=00:15
--
-- Esos se quedaban con la ref POSICIONAL, que es inestable entre scrapes
-- porque el acta de sidgad se ordena de más nuevo a más viejo. Justo lo que la
-- 035 venía a eliminar.
--
-- El crono es lo único imprescindible para identificar un evento; el periodo
-- puede faltar y basta con marcarlo. `eventSourceRef()` en el parser ya usa
-- esta misma regla (`p{periodo|x}`), así que ambos lados coinciden.
--
-- En producción esto afecta a 1 fila de 37.715. Se hace igualmente: una ref
-- inestable en un `direct_foul` o una `blue_card` sí generaría notificaciones
-- repetidas, y no hay razón para dejar el hueco abierto.
-- ============================================================

DROP INDEX IF EXISTS uq_match_events_match_source_ref;

WITH nuevo AS (
  SELECT
    e.id,
    'fep_event_'
      || replace(m.source_ref, 'fep_match_', '')
      || '_p' || COALESCE(e.period::text, 'x')
      || '_'  || replace(e.clock, ':', '')
      || '_'  || e.event_type
      || '_'  || CASE
                   WHEN e.team_id IS NULL          THEN 'x'
                   WHEN e.team_id = m.home_team_id THEN 'H'
                   WHEN e.team_id = m.away_team_id THEN 'A'
                   ELSE 'x'
                 END AS source_ref
  FROM match_events e
  JOIN matches m ON m.id = e.match_id
  WHERE m.source_ref LIKE 'fep_match_%'
    AND e.clock IS NOT NULL        -- el crono sigue siendo imprescindible
    AND e.period IS NULL           -- (lo que tenía periodo ya lo hizo la 035)
)
UPDATE match_events e
   SET source_ref = nuevo.source_ref
  FROM nuevo
 WHERE e.id = nuevo.id
   AND e.source_ref IS DISTINCT FROM nuevo.source_ref;

DELETE FROM match_events me
WHERE me.source_ref IS NOT NULL
  AND me.id <> (
    SELECT keep.id FROM match_events keep
    WHERE keep.match_id   = me.match_id
      AND keep.source_ref = me.source_ref
    ORDER BY keep.created_at DESC, keep.id DESC
    LIMIT 1
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_match_events_match_source_ref
  ON match_events(match_id, source_ref)
  WHERE source_ref IS NOT NULL;

COMMENT ON INDEX uq_match_events_match_source_ref IS
  'Idempotencia de la ficha. La ref se deriva del contenido (periodo, crono, tipo, lado) desde la 035; la 036 la extiende a los eventos sin periodo (p{periodo|x}). Sólo el crono es imprescindible: la posición en el acta NO es estable porque sidgad ordena de más nuevo a más viejo.';

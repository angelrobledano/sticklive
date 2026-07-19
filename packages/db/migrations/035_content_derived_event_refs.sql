-- ============================================================
-- 035 — source_ref de los eventos derivado del CONTENIDO, no de la posición.
--
-- La 034 introdujo UNIQUE(match_id, source_ref) para que el upsert conservara
-- el id de cada evento entre scrapes. La premisa era que `source_ref` fuese
-- estable. NO LO ERA:
--
--   `fep_event_{idp}_{rowIdx}` es la POSICIÓN en la tabla del acta, y el acta
--   de sidgad se ordena de más nuevo a más viejo. Cada incidencia nueva entra
--   por arriba y desplaza a todas las anteriores. Medido sobre tres capturas
--   reales del mismo partido, el mismo gol era `_0`, luego `_12`, luego `_33`:
--   18 de 18 eventos comunes cambiaban de ref entre capturas.
--
-- Consecuencia: el upsert reasignaba contenidos a ids existentes y creaba ids
-- nuevos para eventos viejos, así que el diff por id del push-dispatcher
-- habría re-notificado todos los goles del partido en cada ciclo (~45 s).
--
-- El parser genera ahora la ref desde (periodo, crono, tipo, lado), que es
-- estable entre capturas y no colisiona en ninguna de las cuatro actas de
-- prueba. Esta migración reescribe las refs YA ALMACENADAS con la misma regla,
-- recomputándola desde las columnas, para que los eventos existentes conserven
-- su id cuando el scraper vuelva a pasar por ellos.
--
-- Formato:  fep_event_{idp}_p{periodo}_{cronoSinDosPuntos}_{tipo}_{H|A|x}
-- Ejemplo:  fep_event_34259_p1_2046_goal_H
--
-- Las filas sin periodo o sin crono (importaciones históricas, estrategias de
-- parseo antiguas) se quedan como están: no se puede recomputar su clave y no
-- participan del directo.
--
-- Medido en una BD con el histórico completo (1.485.085 eventos):
--   · 369.855 reescritos (tenían periodo y crono)
--   · 873.354 sin periodo ni crono   → importaciones del histórico
--   · 241.085 con periodo, sin crono → anteriores a la migración 018
--   ·     373 con crono, sin periodo
--   · CERO filas con periodo y crono que quedaran sin reescribir.
-- Tardó ~2 s. No hace falta trocearla por lotes.
--
-- Las actas reales de hoy siempre traen periodo y crono (105 de 105 eventos en
-- los fixtures del parser), así que el directo queda cubierto al 100%. Si algún
-- día se reprocesan actas antiguas con `--entity=refichas`, esos eventos
-- cambiarán de ref y de id: no afecta al push (su ventana sólo mira partidos en
-- vivo o de las últimas 6 h), pero conviene saberlo antes de lanzarlo.
-- ============================================================

-- El índice único se recrea al final. Se retira durante el UPDATE porque una
-- reescritura masiva puede pasar por estados intermedios con refs repetidas
-- (dos eventos intercambiando ref) que un índice no diferible rechazaría.
DROP INDEX IF EXISTS uq_match_events_match_source_ref;

WITH nuevo AS (
  SELECT
    e.id,
    'fep_event_'
      || replace(m.source_ref, 'fep_match_', '')
      || '_p' || e.period
      || '_'  || replace(e.clock, ':', '')
      || '_'  || e.event_type
      || '_'  || CASE
                   WHEN e.team_id IS NULL              THEN 'x'
                   WHEN e.team_id = m.home_team_id     THEN 'H'
                   WHEN e.team_id = m.away_team_id     THEN 'A'
                   ELSE 'x'
                 END AS source_ref
  FROM match_events e
  JOIN matches m ON m.id = e.match_id
  WHERE m.source_ref LIKE 'fep_match_%'
    AND e.period IS NOT NULL
    AND e.clock  IS NOT NULL
)
UPDATE match_events e
   SET source_ref = nuevo.source_ref
  FROM nuevo
 WHERE e.id = nuevo.id
   AND e.source_ref IS DISTINCT FROM nuevo.source_ref;

-- Si dos filas antiguas colapsan en la misma clave (no debería: la combinación
-- es única en las actas reales, pero puede haber basura de importaciones), nos
-- quedamos con la más reciente para poder recrear el índice.
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
  'Idempotencia de la ficha. La ref se deriva del contenido (periodo, crono, tipo, lado) desde la migración 035: la posición en el acta NO es estable porque sidgad ordena de más nuevo a más viejo.';

/**
 * Deriva el desglose del resultado (reglamentario / prórroga / tipo de victoria)
 * de los partidos FINALIZADOS a partir de los eventos ya scrapeados.
 *
 * Qué se puede derivar de los eventos (y qué no):
 *   · Los goles llevan `period`: 1 y 2 = tiempo reglamentario; ≥3 = prórroga.
 *   · `home_goals_reg`/`away_goals_reg` = goles del equipo en periodo ≤ 2.
 *   · Hubo prórroga si existe CUALQUIER evento con periodo ≥ 3.
 *   · win_type: 'overtime' si hay gol en prórroga; 'penalties' si el marcador
 *     final está empatado y hubo fase extra (la tanda no genera goles de evento);
 *     'regular' si lo decidió el tiempo reglamentario.
 *   · winner_team_id: por marcador final (regular/prórroga). En PENALTIS el
 *     marcador queda empatado y la tanda NO está en los eventos → el ganador y el
 *     marcador de penaltis hay que sacarlos del acta (pendiente, ver live-probe).
 *
 * Idempotente: se puede reejecutar; recalcula desde los eventos actuales.
 */
import { db } from '@sports/db';
import { createLogger } from '@sports/logger';

const log = createLogger({ service: 'derive-results' });

export async function deriveMatchResults(seasonIds: string[]): Promise<void> {
  if (seasonIds.length === 0) return;

  const res = await db.query(`
    WITH agg AS (
      SELECT m.id,
             m.home_team_id, m.away_team_id, m.home_score, m.away_score,
             COUNT(*) FILTER (WHERE e.event_type = 'goal' AND e.team_id = m.home_team_id AND COALESCE(e.period, 1) <= 2) AS home_reg,
             COUNT(*) FILTER (WHERE e.event_type = 'goal' AND e.team_id = m.away_team_id AND COALESCE(e.period, 1) <= 2) AS away_reg,
             COUNT(*) FILTER (WHERE COALESCE(e.period, 1) >= 3)                          AS extra_events,
             COUNT(*) FILTER (WHERE e.event_type = 'goal' AND COALESCE(e.period, 1) >= 3) AS ot_goals
      FROM matches m
      LEFT JOIN match_events e ON e.match_id = m.id
      WHERE m.season_id = ANY($1)
        AND m.status = 'finished'
        AND m.updated_at > NOW() - INTERVAL '12 hours'
      GROUP BY m.id, m.home_team_id, m.away_team_id, m.home_score, m.away_score
    )
    UPDATE matches m SET
      home_goals_reg = a.home_reg,
      away_goals_reg = a.away_reg,
      win_type = CASE
        WHEN m.home_score = m.away_score AND a.extra_events > 0 THEN 'penalties'
        WHEN a.ot_goals > 0                                     THEN 'overtime'
        WHEN m.home_score <> m.away_score                       THEN 'regular'
        ELSE NULL END,
      -- Ganador por marcador final (regular/prórroga). En empate (penaltis) se
      -- CONSERVA el ganador que ya haya puesto el acta (parseShootout); no se pisa.
      winner_team_id = CASE
        WHEN m.home_score > m.away_score THEN m.home_team_id
        WHEN m.away_score > m.home_score THEN m.away_team_id
        ELSE m.winner_team_id END,
      updated_at = NOW()
    FROM agg a
    WHERE a.id = m.id
      AND (m.home_score IS NOT NULL AND m.away_score IS NOT NULL)
  `, [seasonIds]);

  if (res.rowCount && res.rowCount > 0) {
    log.info({ matches: res.rowCount }, '🧮 Resultados derivados (reglamentario/prórroga/win_type)');
  }
}

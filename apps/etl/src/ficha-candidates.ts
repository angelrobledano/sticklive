/**
 * Qué actas pide el directo en cada ciclo (cron-live).
 *
 * - Partidos en directo: siempre.
 * - Recién terminados (tocados en las últimas 3 h y jugados en las últimas
 *   48 h) cuyo acta no está completa:
 *     · sin eventos,
 *     · con goles del acta que no cuadran con el marcador (acta parcial,
 *       wse_match_3248 del 8/10: 0-6 con 0-2 en acta),
 *     · con la tanda de penaltis empatada. Una tanda empatada nunca es un
 *       final: el acta se capturó a medias (ITA–CHI del 16/10/2026, 1-1 en
 *       la tanda cuando acabó 1-2) y hay que pedirla hasta que se decida.
 *
 * La guarda de 48 h evita perseguir en bucle actas viejas que la fuente sigue
 * listando (p. ej. incomparecencias antiguas 0-10).
 */
import { db } from '@sports/db';
import { shouldFetchFicha } from './acta-mode.js';

export interface FichaCandidate {
  id: string;
  season_id: string;
  status: string;
  source_ref: string;
  comp_ref: string | null;
  home_team_name: string | null;
  competition_id: string;
  acta_mode: 'live' | 'post' | null;
  acta_post_strikes: number;
  ficha_fetched_at: Date | null;
  ficha_finished_tries: number;
  home_score: number | null;
  away_score: number | null;
}

export async function selectFichaCandidates(seasonIds: string[]): Promise<FichaCandidate[]> {
  const res = await db.query<FichaCandidate>(
    `SELECT m.id, m.season_id, m.status, m.source_ref, comp.source_ref AS comp_ref, ht.name AS home_team_name,
            comp.id AS competition_id, comp.acta_mode, comp.acta_post_strikes,
            m.ficha_fetched_at, m.ficha_finished_tries, m.home_score, m.away_score
     FROM matches m
     JOIN seasons s ON s.id = m.season_id
     JOIN competitions comp ON comp.id = s.competition_id
     LEFT JOIN teams ht ON ht.id = m.home_team_id
     WHERE m.season_id = ANY($1)
       AND m.source_ref IS NOT NULL
       -- Solo sidgad: FPP y FVP cargan su acta en su propio paso del ciclo.
       AND m.source_ref NOT LIKE 'fpp\\_%' AND m.source_ref NOT LIKE 'fvp\\_%'
       AND (
         m.status = 'live'
         OR (
           m.status = 'finished'
           AND m.updated_at   > NOW() - INTERVAL '3 hours'
           AND m.scheduled_at > NOW() - INTERVAL '48 hours'
           AND (
             NOT EXISTS (SELECT 1 FROM match_events me WHERE me.match_id = m.id)
             OR EXISTS (
               SELECT 1 FROM match_events me
                WHERE me.match_id = m.id
                GROUP BY me.match_id
               HAVING COUNT(*) FILTER (WHERE me.event_type='goal' AND me.team_id = m.home_team_id) <> m.home_score
                   OR COUNT(*) FILTER (WHERE me.event_type='goal' AND me.team_id = m.away_team_id) <> m.away_score
             )
             OR (m.home_pen IS NOT NULL AND m.away_pen IS NOT NULL AND m.home_pen = m.away_pen)
           )
         )
       )`,
    [seasonIds]
  );
  // #417: espaciado por competición «solo al final» y reintentos de terminados.
  const now = new Date();
  return res.rows.filter((m) => shouldFetchFicha({
    status: m.status, mode: m.acta_mode, fetchedAt: m.ficha_fetched_at, emptyChecks: m.ficha_finished_tries,
  }, now));
}

/**
 * Directo de la Federación Vasca dentro del ciclo de cron-live (~45 s).
 *
 *   1. ¿Hay partidos FVP en ventana? (en juego, o con inicio entre −5 h y
 *      +30 min). Si no, NINGUNA petición.
 *   2. Un GET a /public/partidos/marcadores → estado y marcador de todo.
 *   3. Cada item se casa con su partido por id (la ref es `fvp_match_{id}`):
 *      sin nombres ni heurística.
 *   4. Los partidos en juego y los recién terminados devuelven su acta para
 *      que cron-live la cargue entre el snapshot y el diff (avisos de gol y
 *      tarjeta) y, en juego, el crono.
 *
 * Un `periodo` desconocido no toca el partido y va a Sentry con su valor.
 */
import { db } from '@sports/db';
import * as Sentry from '@sentry/node';
import { createLogger } from '@sports/logger';
import { fvpGet, fvpPaths } from './fvp-client.js';
import { fvpMatchRef } from './fvp-catalog.js';
import { parseFvpMarcadores } from './fvp-live.parser.js';
import type { FvpFichaTarget } from './fvp-ficha.js';

const log = createLogger({ service: 'fvp-live' });
const reported = new Set<string>();

interface Candidate {
  id: string; season_id: string; sport_id: string; source_ref: string; source_url: string | null;
  status: string; home_team_id: string; away_team_id: string;
}

export interface FvpLiveCycle {
  seasonIds: string[];
  liveRefs: string[];
  fichas: FvpFichaTarget[];
}

export async function fvpLiveCandidates(): Promise<Candidate[]> {
  const { rows } = await db.query<Candidate>(
    `SELECT m.id, m.season_id, c.sport_id, m.source_ref, m.source_url, m.status, m.home_team_id, m.away_team_id
       FROM matches m
       JOIN seasons s      ON s.id = m.season_id AND s.is_current
       JOIN competitions c ON c.id = s.competition_id
      WHERE m.source_ref LIKE 'fvp\\_match\\_%'
        AND m.home_team_id IS NOT NULL AND m.away_team_id IS NOT NULL
        AND (m.status = 'live'
             OR (m.status = 'scheduled'
                 AND m.scheduled_at BETWEEN NOW() - INTERVAL '5 hours' AND NOW() + INTERVAL '30 minutes'))`,
  );
  return rows;
}

export async function runFvpLiveScores(): Promise<FvpLiveCycle> {
  const cands = await fvpLiveCandidates();
  if (cands.length === 0) return { seasonIds: [], liveRefs: [], fichas: [] };

  const items = parseFvpMarcadores(await fvpGet(fvpPaths.liveScores()));
  const byRef = new Map(items.map((i) => [fvpMatchRef(i.matchId), i]));

  const liveRefs: string[] = [];
  const fichas: FvpFichaTarget[] = [];
  let matched = 0;
  for (const cand of cands) {
    const item = byRef.get(cand.source_ref);
    if (!item) continue;
    matched++;
    if (item.state === 'unknown') {
      const key = String(item.rawPeriod);
      if (!reported.has(key)) {
        reported.add(key);
        log.warn({ periodo: item.rawPeriod, match: cand.source_ref }, 'periodo de marcadores desconocido — no se toca el partido');
        Sentry.captureMessage(`FVP marcadores: periodo desconocido ${key}`, {
          level: 'warning', fingerprint: ['fvp-live-state', key], tags: { source: 'fvp' },
          extra: { match: cand.source_ref, item },
        });
      }
      continue;
    }
    if (item.state === 'scheduled') continue;

    const status = item.state === 'finished' ? 'finished' : 'live';
    const halftime = item.state === 'halftime';
    await db.query(
      `UPDATE matches SET
         status = $2::text,
         home_score = COALESCE($3::int, home_score),
         away_score = COALESCE($4::int, away_score),
         live_period = CASE WHEN $2::text = 'live' THEN COALESCE($5::smallint, live_period) ELSE live_period END,
         live_is_halftime = CASE WHEN $2::text = 'live' THEN $6::boolean ELSE FALSE END,
         started_at  = COALESCE(started_at, CASE WHEN $2::text = 'live' THEN NOW() ELSE scheduled_at END),
         finished_at = CASE WHEN $2::text = 'finished' THEN COALESCE(finished_at, NOW()) ELSE finished_at END,
         updated_at  = NOW()
       WHERE id = $1
         AND (status IS DISTINCT FROM $2::text OR home_score IS DISTINCT FROM COALESCE($3::int, home_score)
              OR away_score IS DISTINCT FROM COALESCE($4::int, away_score)
              OR ($2::text = 'live' AND $5::smallint IS NOT NULL AND live_period IS DISTINCT FROM $5::smallint)
              OR live_is_halftime IS DISTINCT FROM (CASE WHEN $2::text = 'live' THEN $6::boolean ELSE FALSE END))`,
      // Marcador oculto (benjamines): se publica 0-0 como la federación.
      [cand.id, status, item.hiddenScore ? 0 : item.homeScore, item.hiddenScore ? 0 : item.awayScore, item.period, halftime],
    );
    if (status === 'live') liveRefs.push(cand.source_ref);
    fichas.push({
      matchId: cand.id, sourceRef: cand.source_ref, sourceUrl: cand.source_url, seasonId: cand.season_id,
      sportId: cand.sport_id, homeTeamId: cand.home_team_id, awayTeamId: cand.away_team_id,
      live: status === 'live' && !halftime,
    });
  }

  log.info({ candidates: cands.length, items: items.length, matched, live: liveRefs.length }, 'FVP directo');
  return { seasonIds: [...new Set(cands.map((c) => c.season_id))], liveRefs, fichas };
}

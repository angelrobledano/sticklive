/**
 * Directo de la FPP dentro del ciclo de cron-live (~45 s).
 *
 *   1. ¿Hay partidos FPP en ventana? (en juego, o con inicio entre −5 h y +30 min)
 *      Si no, no se hace NINGUNA petición.
 *   2. Un GET a /Direto → estado + marcador de todos los partidos del día.
 *   3. Se casa cada item con su partido (por ficha enlazada o por nombres) y se
 *      actualiza estado/marcador/descanso. Solo con señal explícita de la fuente.
 *   4. Los partidos en juego (y los recién terminados) devuelven su objetivo de
 *      ficha para que cron-live cargue timeline y alineaciones en el mismo ciclo,
 *      entre el snapshot y el diff de goles → salen los avisos de gol/tarjeta.
 *
 * Estados que no reconoce el parser → Sentry con el texto literal (una vez por
 * texto y proceso), para afinar el vocabulario con el primer directo real.
 */
import { db } from '@sports/db';
import * as Sentry from '@sentry/node';
import { createLogger } from '@sports/logger';
import { fppGet } from './fpp-client.js';
import { FPP_BASE_URL } from './fpp-structure.js';
import { parseFppDireto, matchItems, implausibleJump, goneLive, type LiveCandidate } from './fpp-live.parser.js';
import type { FppFichaTarget } from './fpp-ficha.js';

const log = createLogger({ service: 'fpp-live' });
const reportedStates = new Set<string>();

type Candidate = LiveCandidate;

export interface FppLiveCycle {
  /** Temporadas FPP con partidos en ventana (para el snapshot/diff de push). */
  seasonIds: string[];
  /** Refs que la fuente da EN JUEGO en este ciclo. */
  liveRefs: string[];
  /** Fichas a cargar en este ciclo (en juego + recién terminados). */
  fichas: FppFichaTarget[];
}

/** Partidos FPP en ventana de directo. Barato: una query, sin red. */
export async function fppLiveCandidates(): Promise<Candidate[]> {
  const { rows } = await db.query<Candidate>(
    `SELECT m.id, m.season_id, c.sport_id, m.source_ref, m.source_url, m.status,
            m.home_team_id, m.away_team_id, ht.name AS home_name, at.name AS away_name,
            m.home_score, m.away_score, m.started_at
       FROM matches m
       JOIN seasons s      ON s.id = m.season_id AND s.is_current
       JOIN competitions c ON c.id = s.competition_id
       JOIN teams ht ON ht.id = m.home_team_id
       JOIN teams at ON at.id = m.away_team_id
      WHERE m.source_ref LIKE 'fpp\\_match\\_%'
        AND (m.status = 'live'
             OR (m.status = 'scheduled'
                 AND m.scheduled_at BETWEEN NOW() - INTERVAL '5 hours' AND NOW() + INTERVAL '30 minutes'))`,
  );
  return rows;
}

export async function runFppLiveScores(): Promise<FppLiveCycle> {
  const cands = await fppLiveCandidates();
  if (cands.length === 0) return { seasonIds: [], liveRefs: [], fichas: [] };

  const html = await fppGet('/Direto');
  const items = parseFppDireto(html);
  if (items.length === 0 && /jogo-item/.test(html)) {
    Sentry.captureMessage('FPP /Direto: hay jogo-item pero el parser no saca ninguno (¿cambió la web?)', {
      level: 'error', fingerprint: ['fpp-direto-parse'], tags: { source: 'fpp' },
    });
  }

  const pairs = matchItems(items, cands);
  const liveRefs: string[] = [];
  const touched: Candidate[] = [];

  for (const { item, cand } of pairs) {
    if (item.state === 'unknown') {
      if (!reportedStates.has(item.stateText)) {
        reportedStates.add(item.stateText);
        log.warn({ stateText: item.stateText, match: cand.source_ref }, 'Estado de /Direto desconocido — no se toca el partido');
        Sentry.captureMessage(`FPP /Direto: estado desconocido "${item.stateText}"`, {
          level: 'warning', fingerprint: ['fpp-direto-state', item.stateText], tags: { source: 'fpp' },
          extra: { match: cand.source_ref, item },
        });
      }
      continue;
    }
    if (item.state === 'scheduled') continue;
    // Marcador imposible entre dos ciclos (Elite Cup 30/10: 7-3 → 7-22): no se
    // guarda y se manda el HTML del item a Sentry para ver qué leímos.
    const prev = { home: cand.home_score ?? null, away: cand.away_score ?? null };
    if (implausibleJump(prev, { home: item.homeScore, away: item.awayScore })) {
      log.warn({ match: cand.source_ref, prev, item: { home: item.homeScore, away: item.awayScore } }, 'FPP /Direto: salto de marcador imposible — se ignora');
      Sentry.captureMessage('FPP /Direto: salto de marcador imposible', {
        level: 'warning', fingerprint: ['fpp-direto-jump'], tags: { source: 'fpp' },
        extra: { match: cand.source_ref, prev, item },
      });
      continue;
    }

    const status = item.state === 'finished' ? 'finished' : 'live';
    const halftime = item.state === 'halftime';
    const url = item.jogoPath ? `${FPP_BASE_URL}${item.jogoPath}` : null;
    await db.query(
      `UPDATE matches SET
         status = $2,
         home_score = COALESCE($3, home_score),
         away_score = COALESCE($4, away_score),
         live_is_halftime = CASE WHEN $2 = 'live' THEN $5 ELSE FALSE END,
         started_at  = COALESCE(started_at, CASE WHEN $2 = 'live' THEN NOW() ELSE scheduled_at END),
         finished_at = CASE WHEN $2 = 'finished' THEN COALESCE(finished_at, NOW()) ELSE finished_at END,
         source_url  = COALESCE($6, source_url),
         updated_at  = NOW()
       WHERE id = $1
         AND (status IS DISTINCT FROM $2 OR home_score IS DISTINCT FROM COALESCE($3, home_score)
              OR away_score IS DISTINCT FROM COALESCE($4, away_score)
              OR live_is_halftime IS DISTINCT FROM (CASE WHEN $2 = 'live' THEN $5 ELSE FALSE END)
              OR source_url IS DISTINCT FROM COALESCE($6, source_url))`,
      [cand.id, status, item.homeScore, item.awayScore, halftime, url],
    );
    if (status === 'live') liveRefs.push(cand.source_ref);
    touched.push({ ...cand, source_url: url ?? cand.source_url, status });
  }

  // En juego pero fuera del feed (pasó la medianoche sin «Final»): terminado,
  // para que no se quede horas «en directo».
  const gone = goneLive(items, cands, new Set(pairs.filter((p) => p.item.state !== 'unknown').map((p) => p.cand.id)));
  for (const c of gone) {
    await db.query(
      `UPDATE matches SET status = 'finished', live_is_halftime = FALSE,
              finished_at = COALESCE(finished_at, NOW()), updated_at = NOW()
        WHERE id = $1 AND status = 'live'`,
      [c.id],
    );
    touched.push({ ...c, status: 'finished' });
  }
  if (gone.length > 0) log.info({ matches: gone.map((c) => c.source_ref) }, 'FPP: en juego fuera de /Direto → terminado');

  const unmatched = items.length - pairs.length;
  log.info({ candidates: cands.length, items: items.length, matched: pairs.length, unmatched, live: liveRefs.length }, 'FPP directo');

  const fichas: FppFichaTarget[] = touched
    .filter((c) => /\/jogo(?:Taca)?\/\d+$/i.test(c.source_url ?? ''))
    .map((c) => ({
      matchId: c.id, sourceRef: c.source_ref, sourceUrl: c.source_url!, seasonId: c.season_id,
      sportId: c.sport_id, homeTeamId: c.home_team_id, awayTeamId: c.away_team_id,
    }));

  return { seasonIds: [...new Set(cands.map((c) => c.season_id))], liveRefs, fichas };
}

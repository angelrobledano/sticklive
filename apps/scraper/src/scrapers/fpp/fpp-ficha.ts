/**
 * Ficha + timeline de los partidos FPP: alineaciones (con foto), técnicos,
 * jugadores, eventos (goles, penaltis, libres directos, tarjetas, faltas,
 * tiempos muertos), faltas de equipo y árbitros.
 *
 * Qué partidos: los FPP terminados con ficha publicada (`source_url` apunta a
 * /jogo o /jogoTaca) que aún no tienen alineación, y los de las últimas 36 h
 * cada 2 h como mucho (la FPP corrige actas después del partido).
 *
 * Mismo destino que el acta FEP (replaceMatchEvents / replaceMatchLineups /
 * refresh_event_coverage), así que la web y la API no necesitan cambios.
 */
import {
  db, withTransaction, replaceMatchEvents, replaceMatchLineups, refreshEventCoverage,
  findPlayerIdBySourceRef, addPlayerSourceRef, type UpsertMatchLineupInput,
} from '@sports/db';
import * as Sentry from '@sentry/node';
import { createLogger } from '@sports/logger';
import { slugifyPlayerName } from '../fep/fep-ficha.parser.js';
import { fppGet } from './fpp-client.js';
import { FPP_BASE_URL } from './fpp-structure.js';
import { FPP_SCRAPER_KEY } from './fpp.scraper.js';
import { FPP_PLAYER_PREFIX, parseFppJogo, parseFppTimeline, splitPtName, type FppLineupEntry } from './fpp-ficha.parser.js';

const log = createLogger({ service: 'fpp-ficha' });

const MAX_PER_RUN = Number(process.env['FPP_FICHAS_MAX'] ?? 120);
const RECENT_HOURS = 36;
const REFRESH_EVERY_HOURS = 2;

export interface FppFichaTarget {
  matchId: string;
  sourceRef: string;
  sourceUrl: string;
  seasonId: string;
  sportId: string;
  homeTeamId: string;
  awayTeamId: string;
}

/** Partidos FPP cuya ficha toca pedir en esta pasada. */
export async function pendingFppFichas(limit = MAX_PER_RUN): Promise<FppFichaTarget[]> {
  const { rows } = await db.query<FppFichaTarget>(
    `SELECT m.id AS "matchId", m.source_ref AS "sourceRef", m.source_url AS "sourceUrl",
            m.season_id AS "seasonId", c.sport_id AS "sportId",
            m.home_team_id AS "homeTeamId", m.away_team_id AS "awayTeamId"
       FROM matches m
       JOIN seasons s      ON s.id = m.season_id
       JOIN competitions c ON c.id = s.competition_id
       LEFT JOIN LATERAL (SELECT max(ml.scraped_at) AS at FROM match_lineups ml WHERE ml.match_id = m.id) l ON TRUE
      WHERE m.source_ref LIKE 'fpp\\_match\\_%'
        AND m.status = 'finished'
        AND m.source_url ~ '/jogo(Taca)?/[0-9]+$'
        AND m.home_team_id IS NOT NULL AND m.away_team_id IS NOT NULL
        AND (
          l.at IS NULL
          OR (m.scheduled_at > NOW() - make_interval(hours => $2)
              AND l.at < NOW() - make_interval(hours => $3))
        )
      ORDER BY (l.at IS NULL) DESC, m.scheduled_at DESC
      LIMIT $1`,
    [limit, RECENT_HOURS, REFRESH_EVERY_HOURS],
  );
  return rows;
}

async function upsertPlayer(t: FppFichaTarget, l: FppLineupEntry): Promise<string | null> {
  if (!l.fedId) return null;
  const ref = `${FPP_PLAYER_PREFIX}${l.fedId}`;
  const photo = l.photoUrl || null;
  let playerId = await findPlayerIdBySourceRef(ref);
  if (playerId) {
    await db.query(`UPDATE players SET photo_url = COALESCE($2, photo_url), updated_at = NOW() WHERE id = $1`, [playerId, photo]);
  } else {
    const { firstName, lastName } = splitPtName(l.name);
    // Homónimos (#176): si el slug ya es de otra persona, se desambigua con el id federativo.
    const base = slugifyPlayerName(l.name) || `jogador-${l.fedId}`;
    const clash = await db.query(`SELECT 1 FROM players WHERE sport_id = $1 AND slug = $2`, [t.sportId, base]);
    const slug = (clash.rowCount ?? 0) > 0 ? `${base}-${l.fedId}` : base;
    playerId = (await db.query<{ id: string }>(
      `INSERT INTO players (sport_id, first_name, last_name, slug, nationality, photo_url, source_ref, source_url, scraped_at)
       VALUES ($1,$2,$3,$4,NULL,$5,$6,$7,NOW())
       ON CONFLICT (sport_id, slug) DO UPDATE SET updated_at = NOW()
       RETURNING id`,
      [t.sportId, firstName, lastName, slug, photo, ref, t.sourceUrl],
    )).rows[0]!.id;
    await addPlayerSourceRef(playerId, ref, 'scraper').catch(() => {});
  }
  await db.query(
    `INSERT INTO team_players (season_id, team_id, player_id) VALUES ($1,$2,$3)
     ON CONFLICT (season_id, team_id, player_id) DO NOTHING`,
    [t.seasonId, l.isHome ? t.homeTeamId : t.awayTeamId, playerId],
  );
  return playerId;
}

/** Descarga y persiste la ficha de UN partido. Devuelve nº de eventos. */
export async function processFppFicha(t: FppFichaTarget): Promise<{ events: number; lineup: number }> {
  const path = t.sourceUrl.replace(FPP_BASE_URL, '');
  const jogo = parseFppJogo(await fppGet(path));
  if (jogo.lineup.length === 0 && !jogo.timelineQuery) {
    log.info({ match: t.sourceRef }, 'Ficha FPP sin alineación ni timeline todavía');
    return { events: 0, lineup: 0 };
  }

  // Jugadores (por id federativo) → mapa ref → UUID.
  const byRef = new Map<string, string>();
  for (const l of jogo.lineup) {
    if (l.role || !l.fedId) continue;
    const id = await upsertPlayer(t, l);
    if (id) byRef.set(`${FPP_PLAYER_PREFIX}${l.fedId}`, id);
  }

  const lineups: UpsertMatchLineupInput[] = jogo.lineup.map((l) => {
    const ref = l.fedId ? `${FPP_PLAYER_PREFIX}${l.fedId}` : undefined;
    return {
      isHome: l.isHome,
      ...(l.jerseyNumber !== null ? { jerseyNumber: l.jerseyNumber } : {}),
      playerName: l.name,
      isStarter: l.isStarter,
      ...(l.role ? { role: l.role } : {}),
      ...(!l.role && ref ? { playerSourceRef: ref, playerId: byRef.get(ref) } : {}),
      scrapedAt: new Date(),
    };
  });

  const jogoKey = t.sourceRef.replace(/^fpp_match_/, '');
  const players = new Set(jogo.lineup.filter((l) => !l.role && l.fedId).map((l) => l.fedId!));
  const events = jogo.timelineQuery
    ? parseFppTimeline(await fppGet(`/Views/ajax_jogo.php?${jogo.timelineQuery}`), jogoKey, players)
    : [];

  await withTransaction(async (client) => {
    if (lineups.length > 0) await replaceMatchLineups(t.matchId, lineups, client);
    if (events.length > 0) {
      await replaceMatchEvents(t.matchId, events.map((e) => ({
        eventType: e.eventType,
        minute: e.minute,
        period: e.period,
        clock: e.clock ?? null,
        teamId: e.isHome === true ? t.homeTeamId : e.isHome === false ? t.awayTeamId : null,
        playerId: e.playerSourceRef ? byRef.get(e.playerSourceRef) ?? null : null,
        detail: e.detail,
        sourceRef: e.sourceRef,
        scrapedAt: new Date(),
      })), client);
    }
    await client.query(
      `UPDATE matches SET home_fouls = COALESCE($2, home_fouls), away_fouls = COALESCE($3, away_fouls),
                          referee = COALESCE($4, referee), updated_at = NOW()
        WHERE id = $1`,
      [t.matchId, jogo.homeFouls, jogo.awayFouls, jogo.referees],
    );
    // 'full' solo si los goles cuadran con el marcador; si no, 'partial' (actas incompletas de la FPP).
    if (events.length > 0) await refreshEventCoverage(t.matchId, client);
  });

  return { events: events.length, lineup: lineups.length };
}

/** Todas las fichas pendientes. Aislado por partido. */
export async function runFppFichas(): Promise<{ done: number; failed: number }> {
  const targets = await pendingFppFichas();
  let done = 0, failed = 0;
  for (const t of targets) {
    try {
      const r = await processFppFicha(t);
      done++;
      log.debug({ match: t.sourceRef, ...r }, 'Ficha FPP cargada');
    } catch (err) {
      failed++;
      log.warn({ err, match: t.sourceRef }, 'Ficha FPP falló — sigue con la siguiente');
    }
  }
  if (targets.length > 0) log.info({ pending: targets.length, done, failed }, 'Fichas FPP');
  if (failed > 0 && failed === targets.length) {
    Sentry.captureMessage(`Fichas FPP: fallaron las ${failed} de esta pasada (¿cambió la web?)`, {
      level: 'warning', fingerprint: ['fpp-fichas-fail'], tags: { source: 'fpp', scraper: FPP_SCRAPER_KEY },
    });
  }
  return { done, failed };
}

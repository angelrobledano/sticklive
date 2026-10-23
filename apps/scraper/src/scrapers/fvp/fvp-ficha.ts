/**
 * Actas de los partidos vascos: alineación (con foto), cuerpo técnico,
 * eventos (goles, penaltis, faltas directas, tarjetas, tiempos muertos,
 * faltas de equipo) y árbitros. Mismo destino que el acta FEP/FPP.
 *
 * Qué partidos: los FVP terminados que aún no tienen alineación, y los de las
 * últimas 36 h como mucho cada 2 h (la federación corrige actas).
 */
import {
  db, withTransaction, replaceMatchEvents, replaceMatchLineups, refreshEventCoverage,
  findPlayerIdBySourceRef, addPlayerSourceRef,
} from '@sports/db';
import * as Sentry from '@sentry/node';
import { createLogger } from '@sports/logger';
import { slugifyPlayerName } from '../fep/fep-ficha.parser.js';
import { splitPtName } from '../fpp/fpp-ficha.parser.js';
import { fvpGet, fvpPaths } from './fvp-client.js';
import { FVP_SCRAPER_KEY } from './fvp-catalog.js';
import { parseFvpActa, lineupToInput, type FvpLineupEntry } from './fvp-ficha.parser.js';

const log = createLogger({ service: 'fvp-ficha' });

const MAX_PER_RUN = Number(process.env['FVP_FICHAS_MAX'] ?? 150);
const RECENT_HOURS = 36;
const REFRESH_EVERY_HOURS = 2;

export interface FvpFichaTarget {
  matchId: string;
  sourceRef: string;
  sourceUrl: string | null;
  seasonId: string;
  sportId: string;
  homeTeamId: string;
  awayTeamId: string;
}

export async function pendingFvpFichas(limit = MAX_PER_RUN): Promise<FvpFichaTarget[]> {
  const { rows } = await db.query<FvpFichaTarget>(
    `SELECT m.id AS "matchId", m.source_ref AS "sourceRef", m.source_url AS "sourceUrl",
            m.season_id AS "seasonId", c.sport_id AS "sportId",
            m.home_team_id AS "homeTeamId", m.away_team_id AS "awayTeamId"
       FROM matches m
       JOIN seasons s      ON s.id = m.season_id
       JOIN competitions c ON c.id = s.competition_id
       LEFT JOIN LATERAL (SELECT max(ml.scraped_at) AS at FROM match_lineups ml WHERE ml.match_id = m.id) l ON TRUE
      WHERE m.source_ref LIKE 'fvp\\_match\\_%'
        AND m.status = 'finished'
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

async function upsertPlayer(t: FvpFichaTarget, l: FvpLineupEntry): Promise<string | null> {
  if (!l.playerRef) return null;
  const photo = l.photoUrl || null;
  let playerId = await findPlayerIdBySourceRef(l.playerRef);
  if (playerId) {
    await db.query(`UPDATE players SET photo_url = COALESCE($2, photo_url), updated_at = NOW() WHERE id = $1`, [playerId, photo]);
  } else {
    // La FVP escribe "NOMBRE APELLIDO(S)" y aparte el nombre de pila.
    const split = splitPtName(l.name);
    const firstName = l.firstName ?? split.firstName;
    const lastName = l.firstName && l.name.toUpperCase().startsWith(l.firstName.toUpperCase())
      ? l.name.slice(l.firstName.length).trim() || split.lastName
      : split.lastName;
    const base = slugifyPlayerName(l.name) || `jugador-${l.plantillaId.slice(0, 8)}`;
    const clash = await db.query(`SELECT 1 FROM players WHERE sport_id = $1 AND slug = $2`, [t.sportId, base]);
    const slug = (clash.rowCount ?? 0) > 0 ? `${base}-${l.playerRef.slice(-8)}` : base;
    playerId = (await db.query<{ id: string }>(
      `INSERT INTO players (sport_id, first_name, last_name, slug, nationality, photo_url, source_ref, source_url, scraped_at)
       VALUES ($1,$2,$3,$4,NULL,$5,$6,$7,NOW())
       ON CONFLICT (sport_id, slug) DO UPDATE SET updated_at = NOW()
       RETURNING id`,
      [t.sportId, firstName, lastName, slug, photo, l.playerRef, t.sourceUrl],
    )).rows[0]!.id;
    await addPlayerSourceRef(playerId, l.playerRef, 'scraper').catch(() => {});
  }
  await db.query(
    `INSERT INTO team_players (season_id, team_id, player_id) VALUES ($1,$2,$3)
     ON CONFLICT (season_id, team_id, player_id) DO NOTHING`,
    [t.seasonId, l.isHome ? t.homeTeamId : t.awayTeamId, playerId],
  );
  return playerId;
}

export async function processFvpFicha(t: FvpFichaTarget): Promise<{ events: number; lineup: number }> {
  const apiId = t.sourceRef.replace(/^fvp_match_/, '');
  const acta = parseFvpActa(await fvpGet(fvpPaths.match(apiId)), apiId);
  if (acta.unknownTypes.length > 0) {
    Sentry.captureMessage(`Acta FVP con incidencias desconocidas: ${acta.unknownTypes.join(', ')}`, {
      level: 'warning', fingerprint: ['fvp-acta-tipos', ...acta.unknownTypes], tags: { source: 'fvp' },
    });
  }
  if (acta.lineup.length === 0 && acta.events.length === 0 && !acta.hiddenScore) return { events: 0, lineup: 0 };

  const byRef = new Map<string, string>();
  for (const l of acta.lineup) {
    if (l.role) continue;
    const id = await upsertPlayer(t, l);
    if (id && l.playerRef) byRef.set(l.playerRef, id);
  }
  const lineups = acta.lineup.map((l) => lineupToInput(l, l.playerRef ? byRef.get(l.playerRef) : undefined));

  await withTransaction(async (client) => {
    if (lineups.length > 0) await replaceMatchLineups(t.matchId, lineups, client);
    if (acta.events.length > 0) {
      await replaceMatchEvents(t.matchId, acta.events.map((e) => ({
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
    if (acta.hiddenScore) {
      // replaceMatchEvents no borra con lista vacía (guarda #149): el marcador
      // oculto se aplica a mano, por si una carga anterior trajo goles.
      await client.query(
        `DELETE FROM match_events WHERE match_id = $1 AND event_type IN ('goal', 'penalty', 'direct_foul')`,
        [t.matchId],
      );
    }
    await client.query(
      `UPDATE matches SET home_fouls = $2, away_fouls = $3, referee = COALESCE($4, referee), updated_at = NOW()
        WHERE id = $1`,
      [t.matchId, acta.homeFouls, acta.awayFouls, acta.referees],
    );
    if (acta.events.length > 0) await refreshEventCoverage(t.matchId, client);
  });
  return { events: acta.events.length, lineup: lineups.length };
}

export async function runFvpFichas(): Promise<{ done: number; failed: number }> {
  const targets = await pendingFvpFichas();
  let done = 0, failed = 0;
  for (const t of targets) {
    try {
      await processFvpFicha(t);
      done++;
    } catch (err) {
      failed++;
      log.warn({ err, match: t.sourceRef }, 'Acta FVP falló — sigue con la siguiente');
    }
  }
  if (targets.length > 0) log.info({ pending: targets.length, done, failed }, 'Actas FVP');
  if (failed > 0 && failed === targets.length) {
    Sentry.captureMessage(`Actas FVP: fallaron las ${failed} de esta pasada (¿cambió la API?)`, {
      level: 'warning', fingerprint: ['fvp-fichas-fail'], tags: { source: 'fvp', scraper: FVP_SCRAPER_KEY },
    });
  }
  return { done, failed };
}

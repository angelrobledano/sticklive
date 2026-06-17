/**
 * Emisor de Web Push — se engancha al ciclo del cron-live.
 *
 * Estrategia: snapshot de partidos antes del ciclo → diff después.
 * Detecta inicio de partido, goles (de cada lado) y final, y notifica a las
 * suscripciones segmentando por las preferencias y favoritos que el cliente
 * sincroniza en push_subscriptions.
 *
 * Política (notification-copy.ts):
 *   · Smart bundling: tag por partido → una notificación viva que se actualiza.
 *   · Silencio nocturno: con quietNight activo, nada entre 23:00–08:00.
 */
import webpush from 'web-push';
import { db } from '@sports/db';
import { createLogger } from '@sports/logger';
import {
  branded, matchTag, goalAlert, finalAlert, liveBody, isQuietHours,
  jornadaStartAlert, jornadaEndAlert, jornadaTag,
  playerGoalAlert, playerTag,
  type MatchRef,
} from '../../api/src/lib/notification-copy.js';

const log = createLogger({ service: 'push-dispatcher' });

const VAPID_PUBLIC  = process.env['VAPID_PUBLIC_KEY']  ?? '';
const VAPID_PRIVATE = process.env['VAPID_PRIVATE_KEY'] ?? '';
const VAPID_SUBJECT = process.env['VAPID_SUBJECT'] ?? 'mailto:robledano@gmail.com';
const WEB_BASE = process.env['WEB_BASE_URL'] ?? 'https://sticklive.eu';

export const pushEnabled = Boolean(VAPID_PUBLIC && VAPID_PRIVATE);
if (pushEnabled) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}

// ── Snapshot/diff ─────────────────────────────────────────────────────────────

export interface MatchSnap {
  id: string;
  status: string;
  home_score: number | null;
  away_score: number | null;
  home_team_id: string | null;
  away_team_id: string | null;
  home_name: string | null;
  away_name: string | null;
}

export async function snapshotMatches(seasonId: string): Promise<Map<string, MatchSnap>> {
  const res = await db.query<MatchSnap>(`
    SELECT m.id, m.status, m.home_score, m.away_score,
           m.home_team_id, m.away_team_id,
           ht.short_name AS home_name, at.short_name AS away_name
    FROM matches m
    LEFT JOIN teams ht ON ht.id = m.home_team_id
    LEFT JOIN teams at ON at.id = m.away_team_id
    WHERE m.season_id = $1
      AND (m.status IN ('live')
           OR m.scheduled_at BETWEEN NOW() - INTERVAL '4 hours' AND NOW() + INTERVAL '4 hours')
  `, [seasonId]);
  return new Map(res.rows.map((r) => [r.id, r]));
}

/** Competición de la temporada (para segmentar por liga favorita). */
export async function seasonCompetitionId(seasonId: string): Promise<string | null> {
  const res = await db.query<{ competition_id: string }>(
    `SELECT competition_id FROM seasons WHERE id = $1`, [seasonId]
  );
  return res.rows[0]?.competition_id ?? null;
}

// ── Jornadas (rondas) ──────────────────────────────────────────────────────────

export interface RoundSnap {
  number: number;
  name: string | null;
  total: number;
  finished: number;
  live: number;
}

/** Estado agregado por ronda (todas las de la temporada). */
export async function snapshotRounds(seasonId: string): Promise<Map<string, RoundSnap>> {
  const res = await db.query<{ id: string; number: number; name: string | null; total: string; finished: string; live: string }>(`
    SELECT r.id, r.number, r.name,
           COUNT(m.id)                                  AS total,
           COUNT(*) FILTER (WHERE m.status = 'finished') AS finished,
           COUNT(*) FILTER (WHERE m.status = 'live')     AS live
    FROM rounds r
    JOIN matches m ON m.round_id = r.id
    WHERE r.season_id = $1
    GROUP BY r.id, r.number, r.name
  `, [seasonId]);
  return new Map(res.rows.map((r) => [r.id, {
    number: r.number, name: r.name,
    total: Number(r.total), finished: Number(r.finished), live: Number(r.live),
  }]));
}

// ── Goles por jugador ───────────────────────────────────────────────────────────

export interface GoalSnap {
  count: number;
  matchId: string;
  playerName: string;
  homeShort: string;
  awayShort: string;
  homeScore: number;
  awayScore: number;
}

/**
 * Conteo de goles por (partido, jugador). Se compara antes/después de las fichas
 * para detectar goles nuevos (los eventos se reemplazan en cada scrape, así que
 * diffeamos por conteo, no por id de evento).
 */
export async function snapshotGoals(seasonId: string): Promise<Map<string, GoalSnap>> {
  const res = await db.query<{
    match_id: string; player_id: string; player_name: string;
    home_short: string | null; away_short: string | null;
    home_score: number | null; away_score: number | null; goals: string;
  }>(`
    SELECT e.match_id, e.player_id,
           TRIM(COALESCE(p.first_name,'') || ' ' || COALESCE(p.last_name,'')) AS player_name,
           ht.short_name AS home_short, at.short_name AS away_short,
           m.home_score, m.away_score,
           COUNT(*) AS goals
    FROM match_events e
    JOIN matches m ON m.id = e.match_id
    LEFT JOIN players p ON p.id = e.player_id
    LEFT JOIN teams ht ON ht.id = m.home_team_id
    LEFT JOIN teams at ON at.id = m.away_team_id
    WHERE m.season_id = $1
      AND e.event_type IN ('goal', 'penalty')
      AND e.player_id IS NOT NULL
      AND (m.status = 'live' OR m.scheduled_at > NOW() - INTERVAL '6 hours')
    GROUP BY e.match_id, e.player_id, p.first_name, p.last_name,
             ht.short_name, at.short_name, m.home_score, m.away_score
  `, [seasonId]);
  const map = new Map<string, GoalSnap>();
  for (const r of res.rows) {
    map.set(`${r.match_id}:${r.player_id}`, {
      count: Number(r.goals),
      matchId: r.match_id,
      playerName: r.player_name || 'Tu jugador',
      homeShort: r.home_short ?? 'Local',
      awayShort: r.away_short ?? 'Visitante',
      homeScore: r.home_score ?? 0,
      awayScore: r.away_score ?? 0,
    });
  }
  return map;
}

interface PushPayload {
  title: string;
  body: string;
  tag: string;
  url: string;
}

interface SubRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  fav_teams: string[];
  fav_leagues: string[];
  fav_players: string[];
  config: Record<string, boolean>;
}

/** Envía un payload a una suscripción; poda la fila si está muerta (404/410). */
async function deliver(sub: SubRow, payload: PushPayload): Promise<'sent' | 'pruned' | 'error'> {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      { TTL: 3600 }
    );
    return 'sent';
  } catch (err: unknown) {
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) {
      await db.query(`DELETE FROM push_subscriptions WHERE id = $1`, [sub.id]);
      return 'pruned';
    }
    log.warn({ status }, 'Fallo al enviar push — continuando');
    return 'error';
  }
}

type MatchEv = { kind: 'start' | 'goal' | 'final'; matchTeams: string[]; payload: PushPayload };
type JornadaEv = { kind: 'jornada_start' | 'jornada_end'; payload: PushPayload };
type Ev = MatchEv | JornadaEv;

/**
 * Compara los snapshots previos (partidos + rondas) con el estado actual y emite:
 *  · eventos de partido (inicio/gol/final) segmentados por equipo O competición,
 *  · alertas de jornada (inicio/fin) globales.
 */
export async function diffAndNotify(
  prev: Map<string, MatchSnap>,
  prevRounds: Map<string, RoundSnap>,
  seasonId: string,
): Promise<void> {
  if (!pushEnabled) return;

  const current = await snapshotMatches(seasonId);
  const toSend: Ev[] = [];

  // ── Eventos de partido ──────────────────────────────────────────────────────
  for (const [id, now] of current) {
    const before = prev.get(id);
    if (!before) continue;

    const ref: MatchRef = {
      homeShort: now.home_name ?? 'Local',
      awayShort: now.away_name ?? 'Visitante',
      homeScore: now.home_score ?? 0,
      awayScore: now.away_score ?? 0,
    };
    const teams = [now.home_team_id, now.away_team_id].filter(Boolean) as string[];
    const url = `${WEB_BASE}/matches/${id}`;
    const tag = matchTag(id);

    if (before.status === 'scheduled' && now.status === 'live') {
      toSend.push({ kind: 'start', matchTeams: teams,
        payload: { title: branded(`${ref.homeShort} – ${ref.awayShort} ¡en juego!`), body: liveBody(ref), tag, url } });
    }

    const homeDiff = (now.home_score ?? 0) - (before.home_score ?? 0);
    const awayDiff = (now.away_score ?? 0) - (before.away_score ?? 0);
    if (now.status === 'live' && (homeDiff > 0 || awayDiff > 0)) {
      const scorer = homeDiff > 0 ? ref.homeShort : ref.awayShort;
      toSend.push({ kind: 'goal', matchTeams: teams,
        payload: { title: branded(goalAlert(scorer, null, ref)), body: liveBody(ref), tag, url } });
    }

    if (before.status !== 'finished' && now.status === 'finished') {
      toSend.push({ kind: 'final', matchTeams: teams,
        payload: { title: branded(finalAlert(ref)), body: '', tag, url } });
    }
  }

  // ── Jornada (inicio/fin) — global ───────────────────────────────────────────
  const curRounds = await snapshotRounds(seasonId);
  for (const [rid, cur] of curRounds) {
    const before = prevRounds.get(rid);
    if (!before) continue;
    const roundName = cur.name || `Jornada ${cur.number}`;
    if (before.live === 0 && cur.live > 0) {
      toSend.push({ kind: 'jornada_start',
        payload: { title: branded(jornadaStartAlert(roundName)), body: '', tag: jornadaTag(rid, 'start'), url: `${WEB_BASE}/` } });
    }
    if (cur.total > 0 && cur.finished === cur.total && before.finished < before.total) {
      toSend.push({ kind: 'jornada_end',
        payload: { title: branded(jornadaEndAlert(roundName)), body: '', tag: jornadaTag(rid, 'end'), url: `${WEB_BASE}/` } });
    }
  }

  if (toSend.length === 0) return;

  const compId = await seasonCompetitionId(seasonId);
  const subs = await db.query<SubRow>(
    `SELECT id, endpoint, p256dh, auth, fav_teams, fav_leagues, fav_players, config FROM push_subscriptions`
  );
  if (subs.rows.length === 0) return;

  const night = isQuietHours();
  let sent = 0, pruned = 0;

  for (const sub of subs.rows) {
    const cfg = sub.config ?? {};
    if (cfg['master'] === false) continue;
    if (night && cfg['quietNight'] !== false) continue; // por defecto, respetar la noche

    const followsLeague = compId != null && (sub.fav_leagues ?? []).includes(compId);

    for (const ev of toSend) {
      let wants: boolean;
      if (!('matchTeams' in ev)) {
        // Jornada (global)
        wants = ev.kind === 'jornada_start'
          ? cfg['globalJornadaStart'] === true
          : cfg['globalJornadaEnd'] === true;
      } else {
        // Seguido = equipo favorito O competición favorita
        const followed = ev.matchTeams.some((t: string) => (sub.fav_teams ?? []).includes(t)) || followsLeague;
        wants =
          ev.kind === 'goal'  ? (followed ? cfg['favGoals'] !== false : false) :
          ev.kind === 'start' ? (followed ? cfg['favMatchStart'] !== false : cfg['globalMatchStart'] === true) :
          /* final */           (followed ? cfg['favMatchEnd'] !== false   : cfg['globalMatchEnd'] === true);
      }
      if (!wants) continue;

      const res = await deliver(sub, ev.payload);
      if (res === 'sent') sent++;
      else if (res === 'pruned') { pruned++; break; }
    }
  }

  log.info({ events: toSend.length, sent, pruned }, '📲 Push despachadas');
}

/**
 * Goles de JUGADORES favoritos. Se llama tras refrescar las fichas (que traen el
 * goleador): compara el conteo de goles por (partido, jugador) antes/después.
 */
export async function diffPlayerGoals(
  prevGoals: Map<string, GoalSnap>,
  seasonId: string,
): Promise<void> {
  if (!pushEnabled) return;

  const cur = await snapshotGoals(seasonId);
  const fresh: Array<{ playerId: string; snap: GoalSnap }> = [];
  for (const [key, now] of cur) {
    const delta = now.count - (prevGoals.get(key)?.count ?? 0);
    const playerId = key.split(':')[1];
    if (delta > 0 && playerId) fresh.push({ playerId, snap: now });
  }
  if (fresh.length === 0) return;

  const subs = await db.query<SubRow>(
    `SELECT id, endpoint, p256dh, auth, fav_teams, fav_leagues, fav_players, config FROM push_subscriptions`
  );
  if (subs.rows.length === 0) return;

  const night = isQuietHours();
  let sent = 0, pruned = 0;

  for (const sub of subs.rows) {
    const cfg = sub.config ?? {};
    if (cfg['master'] === false) continue;
    if (night && cfg['quietNight'] !== false) continue;
    if (cfg['favGoals'] === false) continue;

    for (const g of fresh) {
      if (!(sub.fav_players ?? []).includes(g.playerId)) continue;
      const ref: MatchRef = {
        homeShort: g.snap.homeShort, awayShort: g.snap.awayShort,
        homeScore: g.snap.homeScore, awayScore: g.snap.awayScore,
      };
      const payload: PushPayload = {
        title: branded(playerGoalAlert(g.snap.playerName, ref)),
        body: liveBody(ref),
        tag: playerTag(g.playerId),
        url: `${WEB_BASE}/matches/${g.snap.matchId}`,
      };
      const res = await deliver(sub, payload);
      if (res === 'sent') sent++;
      else if (res === 'pruned') { pruned++; break; }
    }
  }

  log.info({ goals: fresh.length, sent, pruned }, '⚽ Push gol-jugador');
}

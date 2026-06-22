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
  branded, matchTag, finalAlert, liveBody, isQuietHours,
  jornadaStartAlert, jornadaEndAlert, jornadaTag,
  playerGoalAlert, cardAlert, halftimeAlert, secondHalfAlert,
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
  live_is_halftime: boolean;
  live_period: number | null;
}

export async function snapshotMatches(seasonId: string): Promise<Map<string, MatchSnap>> {
  const res = await db.query<MatchSnap>(`
    SELECT m.id, m.status, m.home_score, m.away_score,
           m.home_team_id, m.away_team_id,
           m.live_is_halftime, m.live_period,
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
  playerId: string;
  playerName: string;
  scorerTeamId: string | null;   // equipo del goleador (segmentación por equipo)
  scorerTeamShort?: string | null; // abreviatura del equipo (para copy de tarjeta)
  competitionId: string | null;  // competición (segmentación por liga)
  homeShort: string;
  awayShort: string;
  homeScore: number;
  awayScore: number;
  minute: number | null;         // minuto transcurrido del último gol del jugador
}

/**
 * Conteo de goles por (partido, jugador) sobre TODAS las temporadas activas. Se
 * compara antes/después de las fichas para detectar goles nuevos (los eventos se
 * reemplazan en cada scrape, así que diffeamos por conteo). Incluye el equipo del
 * goleador, la competición y el minuto para enriquecer la notificación.
 */
export async function snapshotGoals(seasonIds: string[]): Promise<Map<string, GoalSnap>> {
  if (seasonIds.length === 0) return new Map();
  const res = await db.query<{
    match_id: string; player_id: string; player_name: string;
    scorer_team_id: string | null; competition_id: string | null;
    home_short: string | null; away_short: string | null;
    home_score: number | null; away_score: number | null;
    minute: number | null; goals: string;
  }>(`
    SELECT e.match_id, e.player_id, e.team_id AS scorer_team_id,
           comp.id AS competition_id,
           TRIM(COALESCE(p.first_name,'') || ' ' || COALESCE(p.last_name,'')) AS player_name,
           ht.short_name AS home_short, at.short_name AS away_short,
           m.home_score, m.away_score,
           MAX(e.minute) AS minute,
           COUNT(*) AS goals
    FROM match_events e
    JOIN matches m ON m.id = e.match_id
    JOIN seasons s ON s.id = m.season_id
    JOIN competitions comp ON comp.id = s.competition_id
    LEFT JOIN players p ON p.id = e.player_id
    LEFT JOIN teams ht ON ht.id = m.home_team_id
    LEFT JOIN teams at ON at.id = m.away_team_id
    WHERE m.season_id = ANY($1)
      AND e.event_type IN ('goal', 'penalty')
      AND e.player_id IS NOT NULL
      AND (m.status = 'live' OR m.scheduled_at > NOW() - INTERVAL '6 hours')
    GROUP BY e.match_id, e.player_id, e.team_id, comp.id, p.first_name, p.last_name,
             ht.short_name, at.short_name, m.home_score, m.away_score
  `, [seasonIds]);
  const map = new Map<string, GoalSnap>();
  for (const r of res.rows) {
    map.set(`${r.match_id}:${r.player_id}`, {
      count: Number(r.goals),
      matchId: r.match_id,
      playerId: r.player_id,
      playerName: r.player_name || 'Tu jugador',
      scorerTeamId: r.scorer_team_id,
      competitionId: r.competition_id,
      homeShort: r.home_short ?? 'Local',
      awayShort: r.away_short ?? 'Visitante',
      homeScore: r.home_score ?? 0,
      awayScore: r.away_score ?? 0,
      minute: r.minute != null ? Number(r.minute) : null,
    });
  }
  return map;
}

/** Tarjetas rojas / expulsiones nuevas por (partido, jugador), multi-temporada. */
export async function snapshotRedCards(seasonIds: string[]): Promise<Map<string, GoalSnap>> {
  if (seasonIds.length === 0) return new Map();
  const res = await db.query<{
    match_id: string; player_id: string; player_name: string;
    scorer_team_id: string | null; scorer_team_short: string | null; competition_id: string | null;
    home_short: string | null; away_short: string | null;
    home_score: number | null; away_score: number | null;
    minute: number | null; cards: string;
  }>(`
    SELECT e.match_id, e.player_id, e.team_id AS scorer_team_id,
           st.short_name AS scorer_team_short, comp.id AS competition_id,
           TRIM(COALESCE(p.first_name,'') || ' ' || COALESCE(p.last_name,'')) AS player_name,
           ht.short_name AS home_short, at.short_name AS away_short,
           m.home_score, m.away_score,
           MAX(e.minute) AS minute,
           COUNT(*) AS cards
    FROM match_events e
    JOIN matches m ON m.id = e.match_id
    JOIN seasons s ON s.id = m.season_id
    JOIN competitions comp ON comp.id = s.competition_id
    LEFT JOIN players p ON p.id = e.player_id
    LEFT JOIN teams st ON st.id = e.team_id
    LEFT JOIN teams ht ON ht.id = m.home_team_id
    LEFT JOIN teams at ON at.id = m.away_team_id
    WHERE m.season_id = ANY($1)
      AND e.event_type = 'red_card'
      AND e.player_id IS NOT NULL
      AND (m.status = 'live' OR m.scheduled_at > NOW() - INTERVAL '6 hours')
    GROUP BY e.match_id, e.player_id, e.team_id, st.short_name, comp.id, p.first_name, p.last_name,
             ht.short_name, at.short_name, m.home_score, m.away_score
  `, [seasonIds]);
  const map = new Map<string, GoalSnap>();
  for (const r of res.rows) {
    map.set(`${r.match_id}:${r.player_id}`, {
      count: Number(r.cards),
      matchId: r.match_id,
      playerId: r.player_id,
      playerName: r.player_name || 'Jugador',
      scorerTeamId: r.scorer_team_id,
      scorerTeamShort: r.scorer_team_short,
      competitionId: r.competition_id,
      homeShort: r.home_short ?? 'Local',
      awayShort: r.away_short ?? 'Visitante',
      homeScore: r.home_score ?? 0,
      awayScore: r.away_score ?? 0,
      minute: r.minute != null ? Number(r.minute) : null,
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

    // El GOL ya no se notifica aquí (por marcador, sin goleador): se emite en
    // diffGoals tras las fichas, con goleador y minuto, y un solo tag por partido.

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
 * GOLES. Se llama tras refrescar las fichas (que traen goleador y minuto):
 * compara el conteo de goles por (partido, jugador) antes/después y emite UN push
 * por gol nuevo, con goleador + minuto, a quien sigue el equipo del goleador, la
 * competición O al jugador. Tag por partido (matchTag) → notificación viva, sin
 * duplicar aunque el usuario siga equipo y jugador a la vez.
 */
export async function diffGoals(
  prevGoals: Map<string, GoalSnap>,
  seasonIds: string[],
): Promise<void> {
  if (!pushEnabled) return;

  const cur = await snapshotGoals(seasonIds);
  const fresh: GoalSnap[] = [];
  for (const [key, now] of cur) {
    const delta = now.count - (prevGoals.get(key)?.count ?? 0);
    if (delta > 0) fresh.push(now);
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
      const followsTeam   = g.scorerTeamId != null && (sub.fav_teams ?? []).includes(g.scorerTeamId);
      const followsLeague = g.competitionId != null && (sub.fav_leagues ?? []).includes(g.competitionId);
      const followsPlayer = (sub.fav_players ?? []).includes(g.playerId);
      if (!(followsTeam || followsLeague || followsPlayer)) continue;

      const ref: MatchRef = {
        homeShort: g.homeShort, awayShort: g.awayShort,
        homeScore: g.homeScore, awayScore: g.awayScore,
        minute: g.minute,
      };
      const payload: PushPayload = {
        title: branded(playerGoalAlert(g.playerName, ref)),
        body: liveBody(ref),
        tag: matchTag(g.matchId), // un único tag por partido → sin duplicar
        url: `${WEB_BASE}/matches/${g.matchId}`,
      };
      const res = await deliver(sub, payload);
      if (res === 'sent') sent++;
      else if (res === 'pruned') { pruned++; break; }
    }
  }

  log.info({ goals: fresh.length, sent, pruned }, '⚽ Push de gol (goleador+minuto)');
}

/**
 * EXPULSIONES (tarjeta roja). Mismo mecanismo que los goles: tras las fichas,
 * un push por roja nueva a quien sigue el equipo, la competición o al jugador.
 */
export async function diffRedCards(
  prev: Map<string, GoalSnap>,
  seasonIds: string[],
): Promise<void> {
  if (!pushEnabled) return;

  const cur = await snapshotRedCards(seasonIds);
  const fresh: GoalSnap[] = [];
  for (const [key, now] of cur) {
    if (now.count - (prev.get(key)?.count ?? 0) > 0) fresh.push(now);
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
    if (cfg['favRedCards'] === false) continue; // toggle "Tarjetas rojas" (default ON)

    for (const c of fresh) {
      const followsTeam   = c.scorerTeamId != null && (sub.fav_teams ?? []).includes(c.scorerTeamId);
      const followsLeague = c.competitionId != null && (sub.fav_leagues ?? []).includes(c.competitionId);
      const followsPlayer = (sub.fav_players ?? []).includes(c.playerId);
      if (!(followsTeam || followsLeague || followsPlayer)) continue;

      const ref: MatchRef = {
        homeShort: c.homeShort, awayShort: c.awayShort,
        homeScore: c.homeScore, awayScore: c.awayScore, minute: c.minute,
      };
      const payload: PushPayload = {
        title: branded(cardAlert('roja', c.playerName, c.scorerTeamShort ?? '', c.minute)),
        body: liveBody(ref),
        tag: matchTag(c.matchId),
        url: `${WEB_BASE}/matches/${c.matchId}`,
      };
      const res = await deliver(sub, payload);
      if (res === 'sent') sent++;
      else if (res === 'pruned') { pruned++; break; }
    }
  }

  log.info({ reds: fresh.length, sent, pruned }, '🟥 Push de expulsión');
}

// ── Fase del partido (descanso / 2ª parte) ───────────────────────────────────

export interface PhaseSnap {
  matchId: string;
  status: string;
  isHalftime: boolean;
  period: number | null;
  homeTeamId: string | null;
  awayTeamId: string | null;
  competitionId: string | null;
  homeShort: string;
  awayShort: string;
  homeScore: number;
  awayScore: number;
}

/** Estado de fase (descanso/periodo) de los partidos en vivo, multi-temporada. */
export async function snapshotPhases(seasonIds: string[]): Promise<Map<string, PhaseSnap>> {
  if (seasonIds.length === 0) return new Map();
  const res = await db.query<{
    id: string; status: string; live_is_halftime: boolean; live_period: number | null;
    home_team_id: string | null; away_team_id: string | null; competition_id: string | null;
    home_short: string | null; away_short: string | null;
    home_score: number | null; away_score: number | null;
  }>(`
    SELECT m.id, m.status, m.live_is_halftime, m.live_period,
           m.home_team_id, m.away_team_id, comp.id AS competition_id,
           ht.short_name AS home_short, at.short_name AS away_short,
           m.home_score, m.away_score
    FROM matches m
    JOIN seasons s ON s.id = m.season_id
    JOIN competitions comp ON comp.id = s.competition_id
    LEFT JOIN teams ht ON ht.id = m.home_team_id
    LEFT JOIN teams at ON at.id = m.away_team_id
    WHERE m.season_id = ANY($1) AND m.status = 'live'
  `, [seasonIds]);
  const map = new Map<string, PhaseSnap>();
  for (const r of res.rows) {
    map.set(r.id, {
      matchId: r.id, status: r.status,
      isHalftime: r.live_is_halftime, period: r.live_period,
      homeTeamId: r.home_team_id, awayTeamId: r.away_team_id, competitionId: r.competition_id,
      homeShort: r.home_short ?? 'Local', awayShort: r.away_short ?? 'Visitante',
      homeScore: r.home_score ?? 0, awayScore: r.away_score ?? 0,
    });
  }
  return map;
}

/**
 * Transiciones de fase: DESCANSO (entra en halftime) y 2ª PARTE (sale del
 * descanso a periodo ≥ 2). Post-fichas (el flag lo escriben las fichas). Solo a
 * seguidores del equipo o la competición, bajo favMatchStart.
 */
export async function diffPhase(
  prev: Map<string, PhaseSnap>,
  seasonIds: string[],
): Promise<void> {
  if (!pushEnabled) return;

  const cur = await snapshotPhases(seasonIds);
  const events: Array<{ snap: PhaseSnap; kind: 'halftime' | 'second_half' }> = [];
  for (const [id, now] of cur) {
    const before = prev.get(id);
    if (!before) continue;
    if (!before.isHalftime && now.isHalftime) events.push({ snap: now, kind: 'halftime' });
    else if (before.isHalftime && !now.isHalftime && (now.period ?? 0) >= 2) events.push({ snap: now, kind: 'second_half' });
  }
  if (events.length === 0) return;

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
    if (cfg['favMatchStart'] === false) continue;

    for (const ev of events) {
      const teams = [ev.snap.homeTeamId, ev.snap.awayTeamId].filter(Boolean) as string[];
      const followed = teams.some((t) => (sub.fav_teams ?? []).includes(t))
        || (ev.snap.competitionId != null && (sub.fav_leagues ?? []).includes(ev.snap.competitionId));
      if (!followed) continue;

      const ref: MatchRef = {
        homeShort: ev.snap.homeShort, awayShort: ev.snap.awayShort,
        homeScore: ev.snap.homeScore, awayScore: ev.snap.awayScore,
      };
      const payload: PushPayload = {
        title: branded(ev.kind === 'halftime' ? halftimeAlert(ref) : secondHalfAlert(ref)),
        body: ev.kind === 'second_half' ? liveBody(ref) : '',
        tag: matchTag(ev.snap.matchId),
        url: `${WEB_BASE}/matches/${ev.snap.matchId}`,
      };
      const res = await deliver(sub, payload);
      if (res === 'sent') sent++;
      else if (res === 'pruned') { pruned++; break; }
    }
  }

  log.info({ phases: events.length, sent, pruned }, '⏱️ Push de fase (descanso/2ª parte)');
}

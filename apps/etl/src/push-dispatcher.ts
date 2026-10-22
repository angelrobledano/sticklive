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
 *   · Resumen matinal: los finales de esa ventana se compensan a las 08:00–12:00
 *     con UN único mensaje agrupado por suscripción (#272).
 */
import webpush from 'web-push';
import * as Sentry from '@sentry/node';
import { db } from '@sports/db';
import { createLogger } from '@sports/logger';
import {
  branded, matchTag, finalAlert, liveBody, isQuietHours, isMorningHours, madridDateKey,
  morningSummary, morningSummaryTag,
  jornadaStartAlert, jornadaEndAlert, jornadaTag,
  playerGoalAlert, cardAlert, directFoulAlert, blueCardWithFoulAlert,
  overtimeStartAlert, penaltyStartAlert, finalOvertimeAlert, finalPenaltiesAlert,
  type MatchRef, type MorningResult,
} from '../../api/src/lib/notification-copy.js';
import {
  freshEvents, collapsePerScorer, decideMatchTransitions, decideRoundTransitions,
  type EventSnap,
} from './push-diff.js';
import { wants, morningPendingSubs, type PushEventType } from './push-segmentation.js';
import { deliverNative, deliverNativeDetailed, loadNativeSubs, type ExpoPayload, type NativeSubRow } from './push-expo.js';

const log = createLogger({ service: 'push-dispatcher' });

const VAPID_PUBLIC  = process.env['VAPID_PUBLIC_KEY']  ?? '';
const VAPID_PRIVATE = process.env['VAPID_PRIVATE_KEY'] ?? '';
const VAPID_SUBJECT = process.env['VAPID_SUBJECT'] ?? 'mailto:hola@sticklive.eu';
const WEB_BASE = process.env['WEB_BASE_URL'] ?? 'https://sticklive.eu';

export const pushEnabled = Boolean(VAPID_PUBLIC && VAPID_PRIVATE);
if (pushEnabled) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}

// ── Snapshot/diff ─────────────────────────────────────────────────────────

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
    JOIN seasons s      ON s.id = m.season_id
    JOIN competitions c ON c.id = s.competition_id
    LEFT JOIN teams ht ON ht.id = m.home_team_id
    LEFT JOIN teams at ON at.id = m.away_team_id
    WHERE m.season_id = $1
      AND s.data_quality = 'ok'
      AND c.data_quality = 'ok'
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

// ── Jornadas (rondas) ───────────────────────────────────────────────────

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
    JOIN seasons s      ON s.id = r.season_id
    JOIN competitions c ON c.id = s.competition_id
    WHERE r.season_id = $1
      AND s.data_quality = 'ok'
      AND c.data_quality = 'ok'
    GROUP BY r.id, r.number, r.name
  `, [seasonId]);
  return new Map(res.rows.map((r) => [r.id, {
    number: r.number, name: r.name,
    total: Number(r.total), finished: Number(r.finished), live: Number(r.live),
  }]));
}

// ── Goles por jugador ────────────────────────────────────────────────────

// El tipo y las funciones de diff viven en `push-diff.ts` (lógica pura, sin
// dependencias) para poder testearlos sin base de datos. Se re-exporta el tipo
// con su nombre histórico para no tocar a los consumidores.
export type GoalSnap = EventSnap;

/**
 * Snapshot de eventos INDIVIDUALES (uno por fila de match_events), indexados por
 * su UUID, sobre todas las temporadas activas.
 *
 * Motor común de `snapshotGoals` y `snapshotEventsByType`. Devuelve una fila por
 * evento — sin GROUP BY — porque el diff es ahora por identidad, no por conteo.
 * Como efecto secundario, `minute` es el minuto REAL del evento y no un MAX
 * agregado que podía atribuir el minuto equivocado a la notificación.
 *
 * Ventana: partidos en juego o de las últimas 6 h (igual que antes).
 */
async function snapshotEvents(
  seasonIds: string[],
  eventTypes: string[],
  opts: { requirePlayer?: boolean; fallbackName?: string } = {},
): Promise<Map<string, GoalSnap>> {
  if (seasonIds.length === 0) return new Map();

  const res = await db.query<{
    event_id: string;
    match_id: string; player_id: string | null; player_name: string;
    actor_team_id: string | null; actor_team_short: string | null; competition_id: string | null;
    home_team_id: string | null; away_team_id: string | null;
    home_short: string | null; away_short: string | null;
    home_score: number | null; away_score: number | null;
    minute: number | null; period: number | null;
  }>(`
    SELECT e.id AS event_id,
           e.match_id, e.player_id, e.team_id AS actor_team_id, e.minute, e.period,
           st.short_name AS actor_team_short, comp.id AS competition_id,
           m.home_team_id, m.away_team_id,
           TRIM(COALESCE(p.first_name,'') || ' ' || COALESCE(p.last_name,'')) AS player_name,
           ht.short_name AS home_short, at.short_name AS away_short,
           m.home_score, m.away_score
    FROM match_events e
    JOIN matches m ON m.id = e.match_id
    JOIN seasons s ON s.id = m.season_id
    JOIN competitions comp ON comp.id = s.competition_id
    LEFT JOIN players p ON p.id = e.player_id
    LEFT JOIN teams st ON st.id = e.team_id
    LEFT JOIN teams ht ON ht.id = m.home_team_id
    LEFT JOIN teams at ON at.id = m.away_team_id
    WHERE m.season_id = ANY($1)
      AND s.data_quality = 'ok'
      AND comp.data_quality = 'ok'
      AND e.event_type = ANY($2)
      AND ($3::boolean = false OR e.player_id IS NOT NULL)
      AND (m.status = 'live' OR m.scheduled_at > NOW() - INTERVAL '6 hours')
  `, [seasonIds, eventTypes, opts.requirePlayer ?? false]);

  const map = new Map<string, GoalSnap>();
  for (const r of res.rows) {
    map.set(r.event_id, {
      eventId: r.event_id,
      matchId: r.match_id,
      playerId: r.player_id,
      playerName: r.player_name || (opts.fallbackName ?? 'Jugador'),
      scorerTeamId: r.actor_team_id,
      scorerTeamShort: r.actor_team_short,
      competitionId: r.competition_id,
      homeTeamId: r.home_team_id,
      awayTeamId: r.away_team_id,
      homeShort: r.home_short ?? 'Local',
      awayShort: r.away_short ?? 'Visitante',
      homeScore: r.home_score ?? 0,
      awayScore: r.away_score ?? 0,
      period: r.period != null ? Number(r.period) : null,
      minute: r.minute != null ? Number(r.minute) : null,
    });
  }
  return map;
}

/**
 * Goles (incluye los de penalti) con goleador identificado, indexados por id de
 * evento. Se compara antes/después de refrescar las fichas para detectar los
 * goles NUEVOS.
 */
export async function snapshotGoals(seasonIds: string[]): Promise<Map<string, GoalSnap>> {
  return snapshotEvents(seasonIds, ['goal', 'penalty'], {
    requirePlayer: true,
    fallbackName: 'Tu jugador',
  });
}

/**
 * Eventos de un tipo dado (roja, azul, falta directa), indexados por id de
 * evento. A diferencia de los goles NO exige jugador: la falta directa puede
 * venir sin lanzador y entonces se segmenta por equipo/competición.
 */
export async function snapshotEventsByType(
  seasonIds: string[], eventType: 'red_card' | 'blue_card' | 'direct_foul',
): Promise<Map<string, GoalSnap>> {
  return snapshotEvents(seasonIds, [eventType]);
}

interface PushPayload {
  title: string;
  body: string;
  tag: string;
  url: string;
  /** Tipo de notificación (para analítica notification_opened en el SW). */
  type: string;
  scorerTeamId?: string | null;
  opponentTeamId?: string | null;
  channelId?: string;
  sound?: string;
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
  /** Mapa "<tipo>:<id>" → preset. Si una entidad seguida no aparece → 'complete'. */
  presets: Record<string, string>;
  device_id: string;
}

/** Columnas que toda consulta de suscripciones necesita (incluye presets). */
const SUBS_COLUMNS = 'id, endpoint, p256dh, auth, fav_teams, fav_leagues, fav_players, config, presets, device_id';

// ── Analítica de servidor: notification_sent (denominador del open rate) ───────
type AnalyticsMod = typeof import('@sports/analytics');
let analyticsMod: AnalyticsMod | null | undefined;
async function getAnalytics(): Promise<AnalyticsMod | null> {
  if (analyticsMod === undefined) {
    try { analyticsMod = await import('@sports/analytics'); }
    catch { analyticsMod = null; } // sin POSTHOG_API_KEY el módulo lanza al importar
  }
  return analyticsMod;
}
/** Registra un envío de push (fire-and-forget; nunca rompe el envío real). */
function captureSent(deviceId: string, type: string): void {
  void (async () => {
    try {
      const a = await getAnalytics();
      a?.analytics.capture({
        distinctId: deviceId || 'unknown',
        event: 'notification_sent',
        properties: { notification_type: type },
      });
    } catch { /* noop */ }
  })();
}
/** Vacía el buffer de analítica al terminar el cron (proceso corto). */
export async function flushPushAnalytics(): Promise<void> {
  try { await analyticsMod?.shutdownAnalytics(); } catch { /* noop */ }
}


/** Envía un payload a una suscripción; poda la fila si está muerta (404/410). */
async function deliver(sub: SubRow, payload: PushPayload): Promise<'sent' | 'pruned' | 'error'> {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      { TTL: 3600 }
    );
    captureSent(sub.device_id, payload.type);
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

// ── Canal nativo (Expo Push) — Task 4.3 ─────────────────────────────────────

/**
 * Cache de suscripciones nativas con TTL de 60 s. cron-live es un proceso
 * LONGEVO (bucle de polling cada 45 s hasta 180 min, ver cron-live.ts): un
 * cache "por invocación" serviría preferencias obsoletas durante todo un
 * directo. 60 s acota la frescura (un registro nuevo tarda ≤1 min en recibir)
 * con UNA query por minuto como máximo, compartida por todos los emisores.
 *
 * NUNCA lanza: si la recarga falla se sigue con la última válida (o vacío si
 * no la hay) con log explícito — el canal web no depende de esta carga y no
 * debe verse afectado por ella.
 */
const NATIVE_SUBS_TTL_MS = 60_000;
let nativeSubsCache: { rows: NativeSubRow[]; at: number } | null = null;
async function nativeSubs(): Promise<NativeSubRow[]> {
  if (!nativeSubsCache || Date.now() - nativeSubsCache.at > NATIVE_SUBS_TTL_MS) {
    try {
      nativeSubsCache = { rows: await loadNativeSubs(), at: Date.now() };
    } catch (err) {
      log.warn({ err }, 'no se pudieron cargar suscripciones nativas — sigo con lo cacheado (o vacío)');
      if (!nativeSubsCache) return [];
    }
  }
  return nativeSubsCache.rows;
}

/** Evento del directo listo para el canal nativo: gate por suscripción (la
 *  MISMA regla que aplicó el bucle web) + payload idéntico al web. */
interface NativeEvent {
  gate: (sub: NativeSubRow) => boolean;
  payload: ExpoPayload;
}

/**
 * Entrega los eventos del directo al canal NATIVO con la misma segmentación
 * que el bucle web (master, silencio nocturno y gate por evento). ADITIVO:
 * corre DESPUÉS del envío web y no lo toca; un fallo del canal nativo queda
 * logueado y no afecta al diff ni a los envíos web ya servidos.
 */
async function deliverNativeEvents(events: NativeEvent[], night: boolean): Promise<void> {
  if (events.length === 0) return;
  const natives = (await nativeSubs()).filter((s) => {
    const cfg = s.config ?? {};
    if (cfg['master'] === false) return false;
    if (night && cfg['quietNight'] !== false) return false; // por defecto, respetar la noche
    return true;
  });
  if (natives.length === 0) return;
  for (const e of events) {
    const targets = natives.filter(e.gate);
    if (targets.length === 0) continue;
    try {
      const res = await deliverNative(targets, e.payload, captureSent);
      log.info({ type: e.payload.type, tag: e.payload.tag, nativeSent: res.sent, nativeFailed: res.failed }, '📱 Push nativo');
    } catch (err) {
      log.warn({ err, type: e.payload.type }, 'push nativo fallo — el canal web ya corrió');
    }
  }
}

/** Gate + payload nativo de un evento de partido/entidad ya resuelto. */
function nativeEventOf(
  ev: PushEventType,
  teamIds: string[], competitionId: string | null, playerId: string | null,
  payload: ExpoPayload,
): NativeEvent {
  return { gate: (s) => wants(s, ev, teamIds, competitionId, playerId), payload };
}

/** Los dos equipos de un evento, sin nulos (mismo filtro que el bucle web). */
function eventTeamIds(x: { homeTeamId: string | null; awayTeamId: string | null }): string[] {
  return [x.homeTeamId, x.awayTeamId].filter(Boolean) as string[];
}

// ── Resumen matinal (#272) ─────────────────────────────────────────────────

export interface NightFinal {
  matchId: string;
  homeTeamId: string | null;
  awayTeamId: string | null;
  competitionId: string | null;
  homeShort: string;
  awayShort: string;
  homeScore: number;
  awayScore: number;
  kickoffLocal: string;
}

/**
 * Partidos que terminaron DENTRO de la ventana de silencio nocturno de la última
 * noche (23:00–08:00, hora española). Son justo los finales que `quietNight`
 * descartó y que el resumen matinal debe compensar.
 *
 * Se apoya en `finished_at` (lo sella el flujo de directo); si faltara, usa
 * `updated_at` como aproximación. La ventana es relativa a HOY, así que un
 * resumen sólo se envía la mañana siguiente — nunca resucita noches antiguas.
 */
async function snapshotNightFinals(): Promise<NightFinal[]> {
  const res = await db.query<{
    match_id: string; home_team_id: string | null; away_team_id: string | null;
    competition_id: string | null; home_short: string; away_short: string;
    home_score: number; away_score: number; kickoff_local: string;
  }>(`
    SELECT m.id AS match_id, m.home_team_id, m.away_team_id, s.competition_id,
           COALESCE(ht.short_name, 'Local')     AS home_short,
           COALESCE(at.short_name, 'Visitante') AS away_short,
           COALESCE(m.home_score, 0)            AS home_score,
           COALESCE(m.away_score, 0)            AS away_score,
           COALESCE(to_char(m.scheduled_at AT TIME ZONE 'Europe/Madrid', 'HH24:MI'), '--:--') AS kickoff_local
    FROM matches m
    JOIN seasons s ON s.id = m.season_id
    JOIN competitions c ON c.id = s.competition_id
    LEFT JOIN teams ht ON ht.id = m.home_team_id
    LEFT JOIN teams at ON at.id = m.away_team_id
    WHERE m.status = 'finished'
      AND s.data_quality = 'ok'
      AND c.data_quality = 'ok'
      AND COALESCE(m.finished_at, m.updated_at) AT TIME ZONE 'Europe/Madrid'
            >= (date_trunc('day', NOW() AT TIME ZONE 'Europe/Madrid') - INTERVAL '1 hour')
      AND COALESCE(m.finished_at, m.updated_at) AT TIME ZONE 'Europe/Madrid'
            <  (date_trunc('day', NOW() AT TIME ZONE 'Europe/Madrid') + INTERVAL '8 hours')
    ORDER BY COALESCE(m.finished_at, m.updated_at) ASC
  `);
  return res.rows.map((r) => ({
    matchId: r.match_id, homeTeamId: r.home_team_id, awayTeamId: r.away_team_id,
    competitionId: r.competition_id,
    homeShort: r.home_short, awayShort: r.away_short,
    homeScore: Number(r.home_score), awayScore: Number(r.away_score),
    kickoffLocal: r.kickoff_local,
  }));
}

/**
 * Resumen matinal (#272 · ledger persistente #383): entrega UN único mensaje
 * agrupado con los resultados que el silencio nocturno descartó anoche, a cada
 * suscripción con `quietNight` activo que siga alguno de esos partidos.
 *
 * Idempotencia PERSISTENTE: cada (suscripción, día de Madrid) servida se registra
 * en `push_summary_log` (migración 056). Así el resumen puede dispararse en CADA
 * invocación del cron (ver `cron-live.ts`) sin duplicar, aunque el proceso se
 * reinicie entre las 08:00 y las 12:00. El `tag` diario hace que, si aun así se
 * reenviara, el push REEMPLACE en la pantalla de bloqueo en vez de apilarse.
 *
 * La selección de destinatarios es pura y testeada (`morningPendingSubs`).
 */
export async function deliverMorningSummaries(now: Date = new Date()): Promise<void> {
  if (!pushEnabled) return;
  if (!isMorningHours(now)) return;          // fuera de 08:00–12:00 no es "matinal"
  const dateKey = madridDateKey(now);

  const finals = await snapshotNightFinals();
  if (finals.length === 0) return;

  const subs = await db.query<SubRow>(`SELECT ${SUBS_COLUMNS} FROM push_subscriptions`);
  // El canal nativo es aditivo: no depende de que existan suscripciones web.
  const natives = await nativeSubs();
  if (subs.rows.length === 0 && natives.length === 0) return;

  // Ledger del día SOLO del canal web: el nativo tiene el suyo (channel
  // 'native', migración 066) y mezclarlos haría que el resumen web saltara a
  // quien ya lo sirvió el nativo (y viceversa).
  const logged = await db.query<{ subscription_id: string }>(
    `SELECT subscription_id FROM push_summary_log WHERE day = $1 AND channel = 'web'`,
    [dateKey],
  );
  const alreadySent = new Set(logged.rows.map((r) => r.subscription_id));

  const pending = morningPendingSubs(subs.rows, finals, alreadySent);

  const tag = morningSummaryTag(dateKey);
  let sent = 0, sentPruned = 0, failed = 0;

  for (const { sub, matches } of pending) {
    const results: MorningResult[] = matches.map((m) => ({
      homeShort: m.homeShort, awayShort: m.awayShort,
      homeScore: m.homeScore, awayScore: m.awayScore,
      kickoffLocal: m.kickoffLocal,
    }));
    const payload: PushPayload = {
      title: branded(morningSummary(results)),
      body: '',
      tag,
      url: `${WEB_BASE}/matches/${matches[0]!.matchId}`,
      type: 'morning_summary',
    };
    const res = await deliver(sub, payload);
    if (res === 'sent' || res === 'pruned') {
      // Registrar ANTES de contarlo: si el INSERT falla, no se marca y se
      // reintentará en la siguiente invocación, sin duplicar a los ya servidos.
      // Columna channel EXPLÍCITA ('web'): aunque hoy sea el DEFAULT, el ledger
      // es por canal y dejarlo implícito es cómo nació el bug del filtro.
      await db.query(
        `INSERT INTO push_summary_log (subscription_id, day, channel) VALUES ($1, $2, 'web') ON CONFLICT DO NOTHING`,
        [sub.id, dateKey],
      );
      if (res === 'sent') sent++; else sentPruned++;
    } else {
      failed++;
    }
  }

  if (pending.length > 0) {
    log.info({ matches: finals.length, pending: pending.length, sent, pruned: sentPruned, failed }, '🌅 Resumen matinal');
  }

  // Canal nativo (Task 4.3): mismo resumen, ledger propio (channel='native',
  // migración 066) para no bloquearse ni duplicarse con el web. Nunca debe
  // romper el resumen web, ya servido arriba.
  try { await deliverNativeMorningSummaries(natives, finals, dateKey, tag); }
  catch (err) { log.warn({ err }, 'resumen matinal nativo fallo — el canal web ya corrió'); }
}

/**
 * Resumen matinal por el canal NATIVO: la misma selección pura
 * (`morningPendingSubs`) sobre push_tokens y un ledger PROPIO (channel
 * 'native') para que web y nativo no se bloqueen ni dupliquen entre sí.
 * ADITIVO: un fallo aquí no toca al resumen web ya servido.
 *
 * El envío va POR LOTES: `groupMorningByPayload` agrupa las subs cuyo resumen
 * tiene el mismo contenido y cada grupo sale en UNA llamada a
 * `deliverNativeDetailed` (troceada a 100 dentro) — con cientos de
 * suscripciones son pocas llamadas HTTP dentro del cron y no un POST por sub.
 * El ledger se marca SOLO de las subs con ticket ok (resultado por-sub).
 * Exportada para tests (push-morning-native.test.ts).
 */
export async function deliverNativeMorningSummaries(
  natives: NativeSubRow[], finals: NightFinal[], dateKey: string, tag: string,
): Promise<void> {
  if (natives.length === 0) return;

  // Solo el ledger del canal nativo: el web tiene el suyo.
  const logged = await db.query<{ subscription_id: string }>(
    `SELECT subscription_id FROM push_summary_log WHERE day = $1 AND channel = 'native'`,
    [dateKey],
  );
  const alreadySentNative = new Set(logged.rows.map((r) => r.subscription_id));

  const pending = morningPendingSubs(natives, finals, alreadySentNative);
  if (pending.length === 0) return;

  let nativeSent = 0, nativeFailed = 0;
  for (const group of groupMorningByPayload(pending)) {
    const results: MorningResult[] = group.matches.map((m) => ({
      homeShort: m.homeShort, awayShort: m.awayShort,
      homeScore: m.homeScore, awayScore: m.awayScore,
      kickoffLocal: m.kickoffLocal,
    }));
    const payload: ExpoPayload = {
      title: branded(morningSummary(results)),
      body: '',
      tag,
      url: `${WEB_BASE}/matches/${group.matches[0]!.matchId}`,
      type: 'morning_summary',
    };
    const res = await deliverNativeDetailed(group.subs, payload, captureSent);
    // Ledger SOLO de las subs con ticket ok, INSERT antes de contar (igual que
    // la web): si el INSERT falla no se marca y se reintentará, sin duplicar a
    // los ya servidos. Un envío rechazado NO se marca: podría ser transitorio
    // y se reintenta. Idempotente por (day, subscription, channel).
    for (const id of res.okSubIds) {
      await db.query(
        `INSERT INTO push_summary_log (subscription_id, day, channel) VALUES ($1, $2, 'native') ON CONFLICT DO NOTHING`,
        [id, dateKey],
      );
      nativeSent++;
    }
    nativeFailed += res.failed;
  }
  log.info({ pending: pending.length, nativeSent, nativeFailed }, '🌅 Resumen matinal (nativo)');
}

/**
 * Agrupa los pendientes del resumen por CONTENIDO del mensaje:
 * `deliverNativeDetailed` manda UN payload a muchas suscripciones (troceando
 * a 100), así que las subs con los mismos partidos comparten lote y el resumen
 * entero sale en pocas llamadas en vez de un POST por suscripción. Dos subs
 * con distinto resumen (favoritos distintos) van en grupos separados. PURA y
 * testeada.
 */
export function groupMorningByPayload(
  pending: Array<{ sub: NativeSubRow; matches: NightFinal[] }>,
): Array<{ subs: NativeSubRow[]; matches: NightFinal[] }> {
  const groups = new Map<string, { subs: NativeSubRow[]; matches: NightFinal[] }>();
  for (const { sub, matches } of pending) {
    // La clave cubre TODO lo que afecta al payload: ids (url del primer
    // partido), marcadores, nombres cortos y kickoff (todos entran en el copy).
    const key = matches
      .map((m) => `${m.matchId}|${m.homeScore}-${m.awayScore}|${m.homeShort}-${m.awayShort}|${m.kickoffLocal}`)
      .join(';;');
    const g = groups.get(key);
    if (g) g.subs.push(sub);
    else groups.set(key, { subs: [sub], matches });
  }
  return [...groups.values()];
}

type MatchEv = { kind: 'start' | 'final'; matchTeams: string[]; payload: PushPayload };
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

  // Resumen matinal (#272): compensa los finales que el silencio nocturno
  // descartó anoche. Se engancha aquí porque es la entrada del dispatcher que
  // corre en el ciclo del cron; la propia función decide si toca (sólo por la
  // mañana) y no duplica. Nunca debe romper el diff normal.
  try { await deliverMorningSummaries(); }
  catch (err) { log.warn({ err }, 'resumen matinal fallo — el diff sigue'); }

  const current = await snapshotMatches(seasonId);
  const toSend: Ev[] = [];

  // ── Eventos de partido ────────────────────────────────────────────────
  // La DECISIÓN (qué transiciones han ocurrido) es lógica pura y testeada en
  // push-diff.ts; aquí sólo se construyen los payloads a partir de ella.
  for (const t of decideMatchTransitions(prev, current)) {
    const now = current.get(t.matchId)!; // la transición viene de `current`
    if (t.kind === 'start_lost') {
      // Partido que aparece directamente como 'live' sin estar en el snapshot
      // previo: no pudimos observar el borde scheduled→live y el aviso de inicio
      // se pierde en silencio (típico de scheduled_at fuera de la ventana ±4h del
      // snapshot, p.ej. por desfase de la fuente). Avisamos para enterarnos.
      Sentry.withScope((scope) => {
        scope.setLevel('warning');
        scope.setTag('phase', 'push-start-edge');
        scope.setExtra('matchId', t.matchId);
        scope.setExtra('teams', `${now.home_name ?? '?'}–${now.away_name ?? '?'}`);
        Sentry.captureMessage('Inicio no notificado: partido apareció "live" sin verse el borde scheduled→live');
      });
      continue;
    }

    const ref: MatchRef = {
      homeShort: now.home_name ?? 'Local',
      awayShort: now.away_name ?? 'Visitante',
      homeScore: now.home_score ?? 0,
      awayScore: now.away_score ?? 0,
    };
    const url = `${WEB_BASE}/matches/${t.matchId}`;
    const tag = matchTag(t.matchId);

    // El GOL ya no se notifica aquí (por marcador, sin goleador): se emite en
    // diffGoals tras las fichas, con goleador y minuto, y un solo tag por partido.
    if (t.kind === 'start') {
      toSend.push({ kind: 'start', matchTeams: t.teams,
        payload: { title: branded(`${ref.homeShort} – ${ref.awayShort} ¡en juego!`), body: liveBody(ref), tag, url, type: 'start' } });
    } else { // 'final'
      toSend.push({ kind: 'final', matchTeams: t.teams,
        payload: { title: branded(finalAlert(ref)), body: '', tag, url, type: 'final' } });
    }
  }

  // ── Jornada (inicio/fin) — global ──────────────────────────────────────
  const curRounds = await snapshotRounds(seasonId);
  for (const t of decideRoundTransitions(prevRounds, curRounds)) {
    const cur = curRounds.get(t.roundId)!;
    const roundName = cur.name || `Jornada ${cur.number}`;
    if (t.kind === 'jornada_start') {
      toSend.push({ kind: 'jornada_start',
        payload: { title: branded(jornadaStartAlert(roundName)), body: '', tag: jornadaTag(t.roundId, 'start'), url: `${WEB_BASE}/`, type: 'jornada_start' } });
    } else { // 'jornada_end'
      toSend.push({ kind: 'jornada_end',
        payload: { title: branded(jornadaEndAlert(roundName)), body: '', tag: jornadaTag(t.roundId, 'end'), url: `${WEB_BASE}/`, type: 'jornada_end' } });
    }
  }

  if (toSend.length === 0) return;

  const compId = await seasonCompetitionId(seasonId);
  const subs = await db.query<SubRow>(`SELECT ${SUBS_COLUMNS} FROM push_subscriptions`);
  // El canal nativo es aditivo: no depende de que existan suscripciones web.
  if (subs.rows.length === 0 && (await nativeSubs()).length === 0) return;

  const night = isQuietHours();
  let sent = 0, pruned = 0;

  for (const sub of subs.rows) {
    const cfg = sub.config ?? {};
    if (cfg['master'] === false) continue;
    if (night && cfg['quietNight'] !== false) continue; // por defecto, respetar la noche

    for (const ev of toSend) {
      let ok: boolean;
      if (!('matchTeams' in ev)) {
        // Jornada (global) — toggles globales, fuera del modelo de presets.
        ok = ev.kind === 'jornada_start'
          ? cfg['globalJornadaStart'] === true
          : cfg['globalJornadaEnd'] === true;
      } else {
        // Inicio/final: gobernados por el preset de la entidad seguida.
        ok = wants(sub, ev.kind, ev.matchTeams, compId, null);
      }
      if (!ok) continue;

      const res = await deliver(sub, ev.payload);
      if (res === 'sent') sent++;
      else if (res === 'pruned') { pruned++; break; }
    }
  }

  log.info({ events: toSend.length, sent, pruned }, '📲 Push despachadas');

  // Canal nativo (Task 4.3): la MISMA segmentación que el bucle web de arriba,
  // otro transporte. ADITIVO — el bucle web no se toca.
  const nativeEvents: NativeEvent[] = toSend.map((ev) => {
    if ('matchTeams' in ev) {
      return nativeEventOf(ev.kind, ev.matchTeams, compId, null, ev.payload);
    }
    // Jornada (global): toggles globales, fuera del modelo de presets (paridad web).
    const toggle = ev.kind === 'jornada_start' ? 'globalJornadaStart' : 'globalJornadaEnd';
    return { gate: (s) => (s.config ?? {})[toggle] === true, payload: ev.payload };
  });
  await deliverNativeEvents(nativeEvents, night);
}

/** Payload de gol (goleador + minuto) — compartido por el canal web y el nativo. */
function goalPayload(g: GoalSnap): PushPayload {
  const ref: MatchRef = {
    homeShort: g.homeShort, awayShort: g.awayShort,
    homeScore: g.homeScore, awayScore: g.awayScore,
    minute: g.minute,
  };
  const opponentTeamId = g.scorerTeamId === g.homeTeamId ? g.awayTeamId : g.homeTeamId;

  return {
    title: branded(playerGoalAlert(g.playerName, ref)),
    body: liveBody(ref),
    tag: matchTag(g.matchId), // un único tag por partido → sin duplicar
    url: `${WEB_BASE}/matches/${g.matchId}`,
    type: 'goal',
    scorerTeamId: g.scorerTeamId,
    opponentTeamId,
  };
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

  // Detección por evento, emisión por goleador: si un jugador marca dos veces
  // dentro del mismo ciclo (~45 s), sale UNA notificación con el gol más
  // avanzado, no dos. Conserva la semántica del diff por conteo anterior — con
  // el mismo `tag` el dispositivo sólo mostraría la última de todas formas,
  // pero evita el doble aviso.
  const fresh = collapsePerScorer(freshEvents(prevGoals, await snapshotGoals(seasonIds)));
  if (fresh.length === 0) return;

  const subs = await db.query<SubRow>(`SELECT ${SUBS_COLUMNS} FROM push_subscriptions`);
  // El canal nativo es aditivo: no depende de que existan suscripciones web.
  if (subs.rows.length === 0 && (await nativeSubs()).length === 0) return;

  const night = isQuietHours();
  let sent = 0, pruned = 0;

  for (const sub of subs.rows) {
    const cfg = sub.config ?? {};
    if (cfg['master'] === false) continue;
    if (night && cfg['quietNight'] !== false) continue;

    for (const g of fresh) {
      // Sigues el partido si sigues a cualquiera de los dos equipos (también el gol
      // del rival), la competición o al goleador; y el preset incluye 'goal'.
      if (!wants(sub, 'goal', eventTeamIds(g), g.competitionId, g.playerId)) continue;

      const res = await deliver(sub, goalPayload(g));
      if (res === 'sent') sent++;
      else if (res === 'pruned') { pruned++; break; }
    }
  }

  log.info({ goals: fresh.length, sent, pruned }, '🏑 Push de gol (goleador+minuto)');

  // Canal nativo (Task 4.3): misma segmentación (equipos/competición/goleador),
  // payload idéntico. ADITIVO.
  await deliverNativeEvents(
    fresh.map((g) => nativeEventOf('goal', eventTeamIds(g), g.competitionId, g.playerId, goalPayload(g))),
    night,
  );
}

/** Payload de tarjeta/falta — compartido por el canal web y el nativo. */
function cardFoulPayload(eventType: 'red_card' | 'blue_card' | 'direct_foul', c: GoalSnap): PushPayload {
  const ref: MatchRef = {
    homeShort: c.homeShort, awayShort: c.awayShort,
    homeScore: c.homeScore, awayScore: c.awayScore, minute: c.minute,
  };
  const title = eventType === 'direct_foul'
    ? directFoulAlert(c.scorerTeamShort ?? '', c.minute)
    : cardAlert(eventType === 'blue_card' ? 'azul' : 'roja', c.playerName, c.scorerTeamShort ?? '', c.minute);
  return {
    title: branded(title),
    body: liveBody(ref),
    tag: matchTag(c.matchId),
    url: `${WEB_BASE}/matches/${c.matchId}`,
    type: eventType,
  };
}

/**
 * TARJETAS Y FALTAS (roja, azul, falta directa). Mismo mecanismo que los goles:
 * tras las fichas, un push por evento nuevo a quien sigue cualquiera de los dos
 * equipos, la competición o al jugador implicado, si su preset incluye el evento.
 * La falta directa puede no traer jugador → se segmenta por equipo/competición.
 */
export async function diffCardOrFoul(
  prev: Map<string, GoalSnap>,
  seasonIds: string[],
  eventType: 'red_card' | 'blue_card' | 'direct_foul',
): Promise<void> {
  if (!pushEnabled) return;

  const fresh = freshEvents(prev, await snapshotEventsByType(seasonIds, eventType));
  if (fresh.length === 0) return;

  const subs = await db.query<SubRow>(`SELECT ${SUBS_COLUMNS} FROM push_subscriptions`);
  // El canal nativo es aditivo: no depende de que existan suscripciones web.
  if (subs.rows.length === 0 && (await nativeSubs()).length === 0) return;

  const night = isQuietHours();
  let sent = 0, pruned = 0;

  for (const sub of subs.rows) {
    const cfg = sub.config ?? {};
    if (cfg['master'] === false) continue;
    if (night && cfg['quietNight'] !== false) continue;

    for (const c of fresh) {
      if (!wants(sub, eventType, eventTeamIds(c), c.competitionId, c.playerId)) continue;

      const res = await deliver(sub, cardFoulPayload(eventType, c));
      if (res === 'sent') sent++;
      else if (res === 'pruned') { pruned++; break; }
    }
  }

  log.info({ eventType, count: fresh.length, sent, pruned }, '🟦 Push de tarjeta/falta');

  // Canal nativo (Task 4.3): misma segmentación, payload idéntico. ADITIVO.
  await deliverNativeEvents(
    fresh.map((c) => nativeEventOf(eventType, eventTeamIds(c), c.competitionId, c.playerId, cardFoulPayload(eventType, c))),
    night,
  );
}

// `freshEvents` y `collapsePerScorer` viven en push-diff.ts (importados arriba).

/**
 * TARJETA AZUL + FALTA DIRECTA con bundling (regla inteligente del spec). Una azul
 * provoca una falta directa en el mismo instante: las emparejamos por (partido,
 * minuto) y emitimos UNA sola notificación combinada. Las azules y faltas sin
 * pareja salen por separado. Azul y FD pertenecen a los mismos niveles de preset
 * (complete/key_events), así que el gate por 'blue_card' no pierde destinatarios.
 */
export async function diffBlueAndFouls(
  prevBlue: Map<string, GoalSnap>,
  prevFoul: Map<string, GoalSnap>,
  seasonIds: string[],
): Promise<void> {
  if (!pushEnabled) return;

  const freshBlue = freshEvents(prevBlue, await snapshotEventsByType(seasonIds, 'blue_card'));
  const freshFoul = freshEvents(prevFoul, await snapshotEventsByType(seasonIds, 'direct_foul'));
  if (freshBlue.length === 0 && freshFoul.length === 0) return;

  type Emission = { snap: GoalSnap; gate: PushEventType; title: string; type: string };
  const emissions: Emission[] = [];
  const usedFoul = new Set<GoalSnap>();
  const bundled = new Set<GoalSnap>();

  // 1) Parejas azul↔FD: mismo partido y mismo minuto (cada FD con una azul máx.).
  for (const b of freshBlue) {
    const f = freshFoul.find((x) =>
      !usedFoul.has(x) && x.matchId === b.matchId &&
      b.minute != null && x.minute != null && x.minute === b.minute);
    if (!f) continue;
    usedFoul.add(f); bundled.add(b);
    const opponent = b.scorerTeamId != null && b.scorerTeamId === b.homeTeamId ? b.awayShort
      : b.scorerTeamId != null && b.scorerTeamId === b.awayTeamId ? b.homeShort : '';
    emissions.push({ snap: b, gate: 'blue_card', type: 'blue_foul',
      title: blueCardWithFoulAlert(b.playerName, b.scorerTeamShort ?? '', opponent, b.minute) });
  }
  // 2) Azules sueltas.
  for (const b of freshBlue) {
    if (bundled.has(b)) continue;
    emissions.push({ snap: b, gate: 'blue_card', type: 'blue_card',
      title: cardAlert('azul', b.playerName, b.scorerTeamShort ?? '', b.minute) });
  }
  // 3) Faltas directas sueltas.
  for (const f of freshFoul) {
    if (usedFoul.has(f)) continue;
    emissions.push({ snap: f, gate: 'direct_foul', type: 'direct_foul',
      title: directFoulAlert(f.scorerTeamShort ?? '', f.minute) });
  }

  const subs = await db.query<SubRow>(`SELECT ${SUBS_COLUMNS} FROM push_subscriptions`);
  // El canal nativo es aditivo: no depende de que existan suscripciones web.
  if (subs.rows.length === 0 && (await nativeSubs()).length === 0) return;

  // Payload azul/FD — compartido por el canal web y el nativo.
  const blueFoulPayload = (em: Emission): PushPayload => {
    const s = em.snap;
    const ref: MatchRef = {
      homeShort: s.homeShort, awayShort: s.awayShort,
      homeScore: s.homeScore, awayScore: s.awayScore, minute: s.minute,
    };
    return {
      title: branded(em.title),
      body: liveBody(ref),
      tag: matchTag(s.matchId),
      url: `${WEB_BASE}/matches/${s.matchId}`,
      type: em.type,
    };
  };

  const night = isQuietHours();
  let sent = 0, pruned = 0;

  for (const sub of subs.rows) {
    const cfg = sub.config ?? {};
    if (cfg['master'] === false) continue;
    if (night && cfg['quietNight'] !== false) continue;

    for (const em of emissions) {
      const s = em.snap;
      if (!wants(sub, em.gate, eventTeamIds(s), s.competitionId, s.playerId)) continue;

      const res = await deliver(sub, blueFoulPayload(em));
      if (res === 'sent') sent++;
      else if (res === 'pruned') { pruned++; break; }
    }
  }

  log.info({ blue: freshBlue.length, fouls: freshFoul.length, bundles: bundled.size, sent, pruned }, '🔵 Push azul/FD (bundling)');

  // Canal nativo (Task 4.3): misma segmentación, payload idéntico. ADITIVO.
  await deliverNativeEvents(
    emissions.map((em) =>
      nativeEventOf(em.gate, eventTeamIds(em.snap), em.snap.competitionId, em.snap.playerId, blueFoulPayload(em))),
    night,
  );
}

// ── Prórroga y penaltis (inicio en vivo + final por tipo) ─────────────────────

export interface ExtraPhaseSnap {
  matchId: string; status: string; period: number | null; hasPenalties: boolean;
  homeTeamId: string | null; awayTeamId: string | null; competitionId: string | null;
  homeShort: string; awayShort: string; homeScore: number; awayScore: number;
}

/** Estado de prórroga/penaltis de los partidos en juego (la ficha escribe live_period y home_pen). */
export async function snapshotExtraPhases(seasonIds: string[]): Promise<Map<string, ExtraPhaseSnap>> {
  if (seasonIds.length === 0) return new Map();
  const res = await db.query<{
    id: string; status: string; live_period: number | null; has_pen: boolean;
    home_team_id: string | null; away_team_id: string | null; competition_id: string | null;
    home_short: string | null; away_short: string | null;
    home_score: number | null; away_score: number | null;
  }>(`
    SELECT m.id, m.status, m.live_period,
           (m.home_pen IS NOT NULL OR m.away_pen IS NOT NULL) AS has_pen,
           m.home_team_id, m.away_team_id, comp.id AS competition_id,
           ht.short_name AS home_short, at.short_name AS away_short,
           m.home_score, m.away_score
    FROM matches m
    JOIN seasons s ON s.id = m.season_id
    JOIN competitions comp ON comp.id = s.competition_id
    LEFT JOIN teams ht ON ht.id = m.home_team_id
    LEFT JOIN teams at ON at.id = m.away_team_id
    WHERE m.season_id = ANY($1) AND m.status IN ('live', 'overtime', 'penalty_shootout')
      AND s.data_quality = 'ok'
      AND comp.data_quality = 'ok'
  `, [seasonIds]);
  const map = new Map<string, ExtraPhaseSnap>();
  for (const r of res.rows) {
    map.set(r.id, {
      matchId: r.id, status: r.status, period: r.live_period, hasPenalties: r.has_pen,
      homeTeamId: r.home_team_id, awayTeamId: r.away_team_id, competitionId: r.competition_id,
      homeShort: r.home_short ?? 'Local', awayShort: r.away_short ?? 'Visitante',
      homeScore: r.home_score ?? 0, awayScore: r.away_score ?? 0,
    });
  }
  return map;
}

/** Payload de inicio de prórroga/penaltis — compartido por el canal web y el nativo. */
function phasePayload(ev: { snap: ExtraPhaseSnap; kind: 'overtime' | 'penalties' }): PushPayload {
  const s = ev.snap;
  const ref: MatchRef = { homeShort: s.homeShort, awayShort: s.awayShort, homeScore: s.homeScore, awayScore: s.awayScore };
  return {
    title: branded(ev.kind === 'overtime' ? overtimeStartAlert(ref) : penaltyStartAlert(ref)),
    body: '',
    tag: matchTag(s.matchId),
    url: `${WEB_BASE}/matches/${s.matchId}`,
    type: ev.kind === 'overtime' ? 'overtime' : 'penalty_shootout',
  };
}

/**
 * Inicio de PRÓRROGA (el crono entra en periodo ≥3) e inicio de PENALTIS
 * (aparece marcador de tanda). Snapshot ANTES de las fichas, diff DESPUÉS.
 */
export async function diffOvertimePenalties(
  prev: Map<string, ExtraPhaseSnap>, seasonIds: string[],
): Promise<void> {
  if (!pushEnabled) return;
  const cur = await snapshotExtraPhases(seasonIds);
  const events: Array<{ snap: ExtraPhaseSnap; kind: 'overtime' | 'penalties' }> = [];
  for (const [id, now] of cur) {
    const before = prev.get(id);
    if (!before || now.status === 'finished') continue;
    if ((before.period ?? 0) <= 2 && (now.period ?? 0) >= 3) events.push({ snap: now, kind: 'overtime' });
    if (!before.hasPenalties && now.hasPenalties)                events.push({ snap: now, kind: 'penalties' });
  }
  if (events.length === 0) return;

  const subs = await db.query<SubRow>(`SELECT ${SUBS_COLUMNS} FROM push_subscriptions`);
  // El canal nativo es aditivo: no depende de que existan suscripciones web.
  if (subs.rows.length === 0 && (await nativeSubs()).length === 0) return;
  const night = isQuietHours();
  let sent = 0, pruned = 0;

  for (const sub of subs.rows) {
    const cfg = sub.config ?? {};
    if (cfg['master'] === false) continue;
    if (night && cfg['quietNight'] !== false) continue;
    for (const ev of events) {
      const s = ev.snap;
      if (!wants(sub, ev.kind, eventTeamIds(s), s.competitionId, null)) continue;
      const res = await deliver(sub, phasePayload(ev));
      if (res === 'sent') sent++;
      else if (res === 'pruned') { pruned++; break; }
    }
  }
  log.info({ events: events.length, sent, pruned }, '⏱️ Push de prórroga/penaltis');

  // Canal nativo (Task 4.3): misma segmentación, payload idéntico. ADITIVO.
  // El final por tipo sí llega con playerId, aquí la fase es del partido: null.
  await deliverNativeEvents(
    events.map((ev) => nativeEventOf(ev.kind, eventTeamIds(ev.snap), ev.snap.competitionId, null, phasePayload(ev))),
    night,
  );
}

export interface ResultSnap {
  matchId: string; status: string; winType: string | null; winnerTeamId: string | null;
  homePen: number | null; awayPen: number | null;
  homeTeamId: string | null; awayTeamId: string | null; competitionId: string | null;
  homeShort: string; awayShort: string; homeScore: number; awayScore: number;
}

/** Resultado de los partidos finalizados recientes (para el final por tipo). */
export async function snapshotResults(seasonIds: string[]): Promise<Map<string, ResultSnap>> {
  if (seasonIds.length === 0) return new Map();
  const res = await db.query<{
    id: string; status: string; win_type: string | null; winner_team_id: string | null;
    home_pen: number | null; away_pen: number | null;
    home_team_id: string | null; away_team_id: string | null; competition_id: string | null;
    home_short: string | null; away_short: string | null;
    home_score: number | null; away_score: number | null;
  }>(`
    SELECT m.id, m.status, m.win_type, m.winner_team_id, m.home_pen, m.away_pen,
           m.home_team_id, m.away_team_id, comp.id AS competition_id,
           ht.short_name AS home_short, at.short_name AS away_short,
           m.home_score, m.away_score
    FROM matches m
    JOIN seasons s ON s.id = m.season_id
    JOIN competitions comp ON comp.id = s.competition_id
    LEFT JOIN teams ht ON ht.id = m.home_team_id
    LEFT JOIN teams at ON at.id = m.away_team_id
    WHERE m.season_id = ANY($1) AND m.status = 'finished'
      AND s.data_quality = 'ok'
      AND comp.data_quality = 'ok'
      AND (m.scheduled_at > NOW() - INTERVAL '12 hours' OR m.updated_at > NOW() - INTERVAL '12 hours')
  `, [seasonIds]);
  const map = new Map<string, ResultSnap>();
  for (const r of res.rows) {
    map.set(r.id, {
      matchId: r.id, status: r.status, winType: r.win_type, winnerTeamId: r.winner_team_id,
      homePen: r.home_pen, awayPen: r.away_pen,
      homeTeamId: r.home_team_id, awayTeamId: r.away_team_id, competitionId: r.competition_id,
      homeShort: r.home_short ?? 'Local', awayShort: r.away_short ?? 'Visitante',
      homeScore: r.home_score ?? 0, awayScore: r.away_score ?? 0,
    });
  }
  return map;
}

/** Payload de final por tipo (prórroga/penaltis) — compartido por web y nativo. */
function resolutionPayload(r: ResultSnap): PushPayload {
  const ref: MatchRef = { homeShort: r.homeShort, awayShort: r.awayShort, homeScore: r.homeScore, awayScore: r.awayScore };
  const winnerShort = r.winnerTeamId === r.homeTeamId ? r.homeShort
    : r.winnerTeamId === r.awayTeamId ? r.awayShort : r.homeShort;
  const title = r.winType === 'overtime'
    ? finalOvertimeAlert(ref, winnerShort)
    : finalPenaltiesAlert(ref, winnerShort, `${r.homePen ?? 0}-${r.awayPen ?? 0}`);
  return {
    title: branded(title),
    body: '',
    tag: matchTag(r.matchId), // mismo tag que el final genérico → lo reemplaza
    url: `${WEB_BASE}/matches/${r.matchId}`,
    type: r.winType === 'overtime' ? 'final_overtime' : 'final_penalties',
  };
}

/**
 * FINAL POR TIPO: cuando se resuelve win_type a prórroga/penaltis (lo fija la
 * ficha/derivación, después del final genérico), emite un final enriquecido con
 * el MISMO tag por partido → reemplaza la notificación de final genérica.
 */
export async function diffResolution(
  prev: Map<string, ResultSnap>, seasonIds: string[],
): Promise<void> {
  if (!pushEnabled) return;
  const cur = await snapshotResults(seasonIds);
  const fresh: ResultSnap[] = [];
  for (const [id, now] of cur) {
    if (now.winType !== 'overtime' && now.winType !== 'penalties') continue;
    const before = prev.get(id);
    const wasResolved = !!before && (before.winType === 'overtime' || before.winType === 'penalties');
    if (!wasResolved) fresh.push(now);
  }
  if (fresh.length === 0) return;

  const subs = await db.query<SubRow>(`SELECT ${SUBS_COLUMNS} FROM push_subscriptions`);
  // El canal nativo es aditivo: no depende de que existan suscripciones web.
  if (subs.rows.length === 0 && (await nativeSubs()).length === 0) return;
  const night = isQuietHours();
  let sent = 0, pruned = 0;

  for (const sub of subs.rows) {
    const cfg = sub.config ?? {};
    if (cfg['master'] === false) continue;
    if (night && cfg['quietNight'] !== false) continue;
    for (const r of fresh) {
      if (!wants(sub, 'final', eventTeamIds(r), r.competitionId, null)) continue;
      const res = await deliver(sub, resolutionPayload(r));
      if (res === 'sent') sent++;
      else if (res === 'pruned') { pruned++; break; }
    }
  }
  log.info({ resolved: fresh.length, sent, pruned }, '🏁 Push de final por tipo (prórroga/penaltis)');

  // Canal nativo (Task 4.3): misma segmentación, payload idéntico. ADITIVO.
  await deliverNativeEvents(
    fresh.map((r) => nativeEventOf('final', eventTeamIds(r), r.competitionId, null, resolutionPayload(r))),
    night,
  );
}

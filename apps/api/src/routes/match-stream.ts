/**
 * SSE endpoint: GET /matches/:id/stream
 *
 * Rediseño (auditoría A1): en vez de que CADA cliente haga polling a la BD,
 * hay UN poller por partido (`Hub`) que consulta la BD cada POLL_INTERVAL_MS y
 * hace fan-out a todos los suscriptores SSE de ese partido. Así el coste pasa
 * de O(clientes) queries a O(partidos en directo) queries.
 *
 * Punto 11 (LISTEN/NOTIFY): el refresco del hub ya no depende del poll de 15 s;
 * lo dispara la BD (migración 043) cuando el partido cambia. El poll queda como
 * respaldo lento.
 *
 * Protocolo SSE (compatible con el cliente):
 *   event: snapshot   → primer envío con el estado completo
 *   event: update     → cambios (score/eventos)
 *   event: finished   → el partido terminó; el cliente cierra
 *   event: keepalive  → mantener viva la conexión
 *   event: timeout    → corte por duración máxima
 *   event: stale      → el poll del hub falló (o se recuperó): el cliente
 *                       atenúa el marcador y muestra "posible desfase" (#284)
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { db, listenForNotifications } from '@sports/db';
import { logger } from '@sports/logger';
import { ConnectionLimiter } from '../lib/sse-connections.js';
import { clientIp } from '../lib/rate-limit.js';
import { isUuid } from '../lib/uuid.js';
import {
  applySnapshot,
  emptyHubState,
  enqueueBounded,
  eventForKind,
  SSE_NOT_FOUND_ERROR,
  type HubState,
  type SseKind,
} from '../lib/sse-hub.js';
import {
  buildMatchDetail,
  type MatchDtoRow,
  type MatchDtoEventRow,
  type MatchLineupRow,
} from '../lib/match-dto.js';

export const matchStreamRouter = new Hono();

// ─── Configuración ──────────────────────────────────────────────────
// Poll de RESPALDO. Desde el punto 11 el refresco lo dispara la BD por
// LISTEN/NOTIFY (migración 043): cuando un partido cambia, la API refresca su
// hub al instante. Este intervalo es sólo la red de seguridad por si se pierde
// un aviso (reconexión del listener, etc.), de ahí que sea lento.
const BACKUP_POLL_MS         = Number(process.env['SSE_BACKUP_POLL_MS'] ?? 60_000);
// Keepalive: mantiene viva la conexión y, de paso, es el ciclo en el que el
// handler nota un cliente desaparecido (el write falla) y libera su cupo.
// Env-driven (#378): los tests de e2e lo bajan para verificar la liberación.
const KEEPALIVE_INTERVAL_MS   = Number(process.env['SSE_KEEPALIVE_INTERVAL_MS'] ?? 25_000);
// #371: intervalo de reconexión base que se anuncia al navegador con `retry:`.
// Sin esto, tras un reinicio del servidor todo el parque reconecta a la vez
// (herd) con el intervalo por defecto. El cliente añade backoff+jitter encima.
const SSE_RETRY_MS = Number(process.env['SSE_RETRY_MS'] ?? 5_000);
// Duración máxima de UNA conexión SSE. Es una válvula de seguridad contra
// conexiones zombi, no un límite de producto: un partido de hockey patines
// dura ~70-90 min reales (2×25 + descanso + posible prórroga y penaltis).
// Con 30 min, todo el mundo acababa en el polling de fallback justo en el
// tramo decisivo. El cliente además reconecta al recibir `event: timeout`.
const MAX_STREAM_DURATION_MS = Number(process.env['SSE_MAX_DURATION_MS'] ?? 2 * 60 * 60 * 1_000);
const MAX_CONNECTIONS = Number(process.env['SSE_MAX_CONNECTIONS'] ?? 1000);
// Tope por IP para que un solo cliente no agote el cupo global y deje sin
// directo a todos los demás (#160).
const MAX_CONNECTIONS_PER_IP = Number(process.env['SSE_MAX_CONNECTIONS_PER_IP'] ?? 10);
// Las alineaciones cambian cuando el acta publica goles/asistencias. Recalcular
// ese JOIN con `players` en cada poll por partido en vivo era el grueso del
// coste del hub, por eso se cachea. Pero un TTL de 5 min dejaba al goleador
// desfasado hasta 5 min (#376): se baja a 1 min y, además, un cambio de eventos
// invalida la caché al instante (ver pollHub), de modo que la frescura no
// depende sólo del reloj.
const LINEUPS_TTL_MS = Number(process.env['SSE_LINEUPS_TTL_MS'] ?? 60_000);
// Tope de eventos en cola por conexión (#333). `writeSSE` es backpressure real:
// un cliente que no consume hacía crecer `queue` sin límite. Al tope se descarta
// lo más antiguo (ver enqueueBounded).
const MAX_SSE_QUEUE = Number(process.env['SSE_MAX_QUEUE'] ?? 200);

// ─── Query helpers (sin cambios funcionales) ──────────────────────────────

/**
 * Snapshot del partido con el MISMO DTO que REST (`GET /matches/:id`) para que
 * el directo no pierda competición, cronos ni stats (#283). Se añade
 * `updatedAt` (instante de captura) para el indicador de frescura (#284).
 */
async function fetchMatchSnapshot(matchId: string) {
  // #333: las tres queries son independientes (todas por match_id). En serie
  // sumaban tres round-trips; en paralelo el snapshot tarda el máximo, no la
  // suma. Si el partido no existe, las de eventos/lineups devuelven vacío.
  const [matchResult, eventsResult, lineups] = await Promise.all([
    db.query<MatchDtoRow>(`
      SELECT
        m.id, m.season_id, m.round_id,
        m.home_score, m.away_score, m.home_fouls, m.away_fouls, m.status, m.event_coverage,
        m.home_goals_reg, m.away_goals_reg, m.home_pen, m.away_pen, m.win_type, m.winner_team_id, m.penalty_shootout,
        m.scheduled_at, m.started_at, m.finished_at,
        m.venue_name, m.venue_city, m.referee, m.source_ref, m.video_url,
        m.live_period, m.live_clock_seconds, m.live_clock_at, m.live_is_halftime,
        ht.id           AS home_team_id,
        ht.name         AS home_team_name,
        ht.short_name   AS home_team_short_name,
        ht.logo_url     AS home_team_logo_url,
        at.id           AS away_team_id,
        at.name         AS away_team_name,
        at.short_name   AS away_team_short_name,
        at.logo_url     AS away_team_logo_url,
        comp.id         AS competition_id,
        comp.name       AS competition_name,
        comp.slug       AS competition_slug,
        comp.timezone   AS competition_timezone
      FROM matches m
      LEFT JOIN teams ht ON ht.id = m.home_team_id
      LEFT JOIN teams at ON at.id = m.away_team_id
      LEFT JOIN seasons s        ON s.id = m.season_id
      LEFT JOIN competitions comp ON comp.id = s.competition_id
      WHERE m.id = $1
        AND s.data_quality = 'ok'
        AND comp.data_quality = 'ok'
    `, [matchId]),
    db.query<MatchDtoEventRow>(`
      SELECT
        e.id, e.event_type, e.minute, e.period, e.clock,
        e.team_id, e.detail, e.player_id,
        p.first_name AS player_first_name, p.last_name AS player_last_name
      FROM match_events e
      LEFT JOIN players p ON p.id = e.player_id
      WHERE e.match_id = $1
      ORDER BY COALESCE(e.period, 99) ASC, e.clock DESC NULLS LAST, COALESCE(e.minute, 9999) ASC, e.created_at ASC
    `, [matchId]),
    // Alineaciones — paridad con el REST para que el directo no las pierda.
    fetchLineups(matchId),
  ]);

  const row = matchResult.rows[0];
  if (!row) return null;

  return {
    ...buildMatchDetail(row, eventsResult.rows, lineups),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Alineaciones CRUDAS del partido, cacheadas por `LINEUPS_TTL_MS`.
 *
 * El hub sondea cada 15 s, pero las alineaciones sólo cambian cuando el acta
 * publica goles/asistencias — información que el cliente ya recibe por
 * `events`. Sin caché, este JOIN con `players` se repetía por partido en vivo
 * y por tick, dominando el coste del directo en BD. Se cachean las filas para
 * que el mapper compartido (`buildMatchDetail`) derive también las asistencias.
 */
const lineupsCache = new Map<string, { rows: MatchLineupRow[]; expiresAt: number }>();

async function fetchLineups(matchId: string): Promise<MatchLineupRow[]> {
  const cached = lineupsCache.get(matchId);
  if (cached && cached.expiresAt > Date.now()) return cached.rows;

  const lineupsResult = await db.query<MatchLineupRow>(`
    SELECT ml.is_home, ml.jersey_number, ml.player_name, ml.player_id,
           ml.is_goalkeeper, ml.is_starter, ml.is_captain, ml.goals, ml.assists,
           p.photo_url
    FROM match_lineups ml
    LEFT JOIN players p ON p.id = ml.player_id
    WHERE ml.match_id = $1
      AND ml.role IS NULL
    ORDER BY ml.is_home DESC, ml.is_starter DESC, ml.jersey_number ASC NULLS LAST
  `, [matchId]);

  lineupsCache.set(matchId, { rows: lineupsResult.rows, expiresAt: Date.now() + LINEUPS_TTL_MS });
  return lineupsResult.rows;
}

// ─── Hub: un poller por partido, fan-out a N suscriptores ──────────────────────

/**
 * Suscriptor del hub. `kind` decide el nombre del evento SSE, salvo que se pase
 * un `override` explícito (p. ej. `stale`), que gana (#284).
 */
type Subscriber = (json: string, kind: SseKind, override?: string) => void;

interface Hub {
  subscribers: Set<Subscriber>;
  timer: ReturnType<typeof setInterval> | null;
  /** Debounce de los avisos NOTIFY: colapsa una ráfaga en un solo refresh. */
  refreshTimer: ReturnType<typeof setTimeout> | null;
  /** Último snapshot enviado y métricas para decidir el siguiente fan-out. */
  state: HubState;
  /** true si el último poll falló: el directo debe mostrarse "posible desfase" (#284). */
  stale: boolean;
  /** #333: evita polls solapados (NOTIFY + poll de respaldo) sobre el mismo hub. */
  polling: boolean;
}

const hubs = new Map<string, Hub>();

// Un partido que marca escribe, en el mismo scrape, el marcador y varios
// eventos: cada uno emite su NOTIFY. Coalescemos esa ráfaga en un refresh.
const NOTIFY_DEBOUNCE_MS = 250;

function scheduleRefresh(matchId: string) {
  const hub = hubs.get(matchId);
  if (!hub || hub.refreshTimer) return; // ya hay un refresh en cola
  hub.refreshTimer = setTimeout(() => {
    hub.refreshTimer = null;
    void pollHub(matchId);
  }, NOTIFY_DEBOUNCE_MS);
  hub.refreshTimer.unref?.();
}

function fanout(hub: Hub, json: string, kind: SseKind, override?: string) {
  for (const cb of hub.subscribers) {
    try { cb(json, kind, override); } catch { /* el wrapper de cada conexión se limpia solo */ }
  }
}

function stopHub(matchId: string) {
  const hub = hubs.get(matchId);
  if (!hub) return;
  if (hub.timer) clearInterval(hub.timer);
  if (hub.refreshTimer) clearTimeout(hub.refreshTimer);
  hubs.delete(matchId);
  lineupsCache.delete(matchId); // no acumular alineaciones de partidos cerrados
}

async function pollHub(matchId: string) {
  const hub = hubs.get(matchId);
  // #333: no re-entrante. Un NOTIFY y el poll de respaldo podían solaparse si un
  // poll tardaba >250 ms, disparando dos fetches concurrentes del mismo partido.
  if (!hub || hub.polling) return;
  hub.polling = true;
  try {
    let snapshot: Awaited<ReturnType<typeof fetchMatchSnapshot>>;
    try {
      snapshot = await fetchMatchSnapshot(matchId);
    } catch (err) {
      logger.warn({ matchId, err }, 'SSE poll error');
      // #284: el fallo no puede ser silencioso. Avisamos UNA vez por transición
      // para que la ficha deje de mostrar un marcador congelado como actual.
      if (!hub.stale) {
        hub.stale = true;
        fanout(hub, JSON.stringify({ stale: true, updatedAt: new Date().toISOString() }), 'data', 'stale');
      }
      return; // reintentamos en el siguiente tick
    }
    if (!snapshot) {
      // #333: forma de error coherente con el resto de la API (antes { message }).
      fanout(hub, JSON.stringify(SSE_NOT_FOUND_ERROR), 'error');
      stopHub(matchId);
      return;
    }

    // El poll volvió a funcionar tras un fallo: retiramos el aviso de desfase.
    if (hub.stale) {
      hub.stale = false;
      fanout(hub, JSON.stringify({ stale: false, updatedAt: new Date().toISOString() }), 'data', 'stale');
    }

    const diff = applySnapshot(hub.state, snapshot);
    const firstSnapshot = hub.state.lastSnapshotJson === null;
    hub.state = diff.state;

    if (diff.changed) fanout(hub, diff.json, 'data');

    // #376: un gol (o una corrección de acta) puede traer asistencias/goles
    // nuevos en `match_lineups` sin cambiar el marcador ni el listado de
    // eventos. Invalidamos la caché y forzamos un refresco inmediato para que
    // el goleador se refleje en segundos, no al vencer el TTL. El guard
    // `!firstSnapshot` evita un segundo poll inútil en el arranque del hub.
    if (!firstSnapshot && diff.eventsChanged && snapshot.match.status !== 'finished') {
      lineupsCache.delete(matchId);
      scheduleRefresh(matchId);
    }

    if (snapshot.match.status === 'finished') {
      fanout(hub, JSON.stringify({ matchId, finishedAt: snapshot.match.finishedAt }), 'finished');
      stopHub(matchId);
    }
  } finally {
    hub.polling = false;
  }
}

function subscribe(matchId: string, cb: Subscriber) {
  let hub = hubs.get(matchId);
  if (!hub) {
    hub = { subscribers: new Set(), timer: null, refreshTimer: null, state: emptyHubState(), stale: false, polling: false };
    hubs.set(matchId, hub);
    hub.timer = setInterval(() => { void pollHub(matchId); }, BACKUP_POLL_MS);
    void pollHub(matchId); // primer poll inmediato
  }
  hub.subscribers.add(cb);
  // Si ya hay snapshot en caché, lo entregamos al recién llegado al instante.
  if (hub.state.lastSnapshotJson) cb(hub.state.lastSnapshotJson, 'data');
  // Y si el hub ya está en fallo, avisamos sin esperar al reloj de frescura.
  if (hub.stale) cb(JSON.stringify({ stale: true, updatedAt: new Date().toISOString() }), 'data', 'stale');
}

function unsubscribe(matchId: string, cb: Subscriber) {
  const hub = hubs.get(matchId);
  if (!hub) return;
  hub.subscribers.delete(cb);
  if (hub.subscribers.size === 0) stopHub(matchId);
}

// ─── Push desde la BD (LISTEN/NOTIFY, migración 043) ───────────────────────
// Una conexión dedicada escucha el canal `match_update`; cuando la BD avisa de
// un cambio en un partido, refrescamos su hub AL INSTANTE (si tiene
// espectadores). Los avisos de partidos sin hub abierto se ignoran, así que el
// coste en la API es nulo salvo para los partidos que alguien está viendo. Es la
// vía PRINCIPAL de refresco; el poll de respaldo (BACKUP_POLL_MS) sólo cubre el
// hueco si se pierde un aviso (p. ej. mientras el listener reconecta).
listenForNotifications('match_update', (matchId) => {
  scheduleRefresh(matchId); // no-op si no hay hub para ese partido
});

// ─── Endpoint SSE ──────────────────────────────────────────────────

// Un id que no sea UUID haría fallar el cast de Postgres en cada poll: el hub
// reintentaría indefinidamente y la conexión quedaría zombi consumiendo slot
// (y el cliente nunca recibiría `event: error`). Se rechaza antes de crear el
// hub (#160). Validación compartida con el resto de rutas (#275/#321).
const connections = new ConnectionLimiter(MAX_CONNECTIONS, MAX_CONNECTIONS_PER_IP);

matchStreamRouter.get('/:id/stream', async (c) => {
  const matchId = c.req.param('id');

  if (!isUuid(matchId)) {
    return c.json({ error: 'not_found' }, 404);
  }

  const ip = clientIp(c);
  if (!connections.tryAcquire(ip).ok) {
    return c.json({ error: 'too_many_connections' }, 503);
  }

  const origin = process.env['WEB_BASE_URL'];
  if (origin) c.header('Access-Control-Allow-Origin', origin); // sin fallback a '*'
  c.header('Cache-Control', 'no-cache');
  c.header('X-Accel-Buffering', 'no');

  return streamSSE(c, async (stream) => {
    const startedAt = Date.now();
    const queue: Array<{ json: string; ev: string }> = [];
    let wake: (() => void) | null = null;
    let firstSent = false;
    let done = false;

    const onData: Subscriber = (json, kind, override) => {
      let event: string;
      if (override) {
        event = override; // p. ej. `stale`: no altera firstSent
      } else {
        const named = eventForKind(kind, firstSent);
        firstSent = named.firstSent;
        event = named.event;
      }
      enqueueBounded(queue, { json, ev: event }, MAX_SSE_QUEUE);
      wake?.();
    };

    subscribe(matchId, onData);

    try {
      // #371: anuncia el intervalo de reconexión base. El cliente aplica backoff
      // y jitter por encima; esto evita que todos reconecten con el default del
      // navegador (herd) tras un reinicio del servidor.
      await stream.write(`retry: ${SSE_RETRY_MS}\n\n`);

      while (!done) {
        if (Date.now() - startedAt > MAX_STREAM_DURATION_MS) {
          await stream.writeSSE({ event: 'timeout', data: '{"reason":"max_duration"}' });
          break;
        }
        if (queue.length === 0) {
          // Espera dato nuevo (wake) o vencimiento del keepalive, lo que llegue antes.
          await new Promise<void>((resolve) => {
            let settled = false;
            const finish = () => { if (settled) return; settled = true; clearTimeout(t); wake = null; resolve(); };
            const t = setTimeout(finish, KEEPALIVE_INTERVAL_MS);
            wake = finish;
          });
          if (queue.length === 0) {
            await stream.writeSSE({ event: 'keepalive', data: '' });
            continue;
          }
        }
        while (queue.length > 0) {
          const m = queue.shift()!;
          await stream.writeSSE({ event: m.ev, data: m.json });
          if (m.ev === 'finished' || m.ev === 'error') { done = true; break; }
        }
      }
    } catch (err) {
      logger.warn({ matchId, err }, 'SSE stream cerrado por el cliente');
    } finally {
      unsubscribe(matchId, onData);
      connections.release(ip);
    }
  });
});

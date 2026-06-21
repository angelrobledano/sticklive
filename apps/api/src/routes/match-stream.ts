/**
 * SSE endpoint: GET /matches/:id/stream
 *
 * Rediseño (auditoría A1): en vez de que CADA cliente haga polling a la BD,
 * hay UN poller por partido (`Hub`) que consulta la BD cada POLL_INTERVAL_MS y
 * hace fan-out a todos los suscriptores SSE de ese partido. Así el coste pasa
 * de O(clientes) queries a O(partidos en directo) queries.
 *
 * Protocolo SSE (sin cambios para el cliente):
 *   event: snapshot   → primer envío con el estado completo
 *   event: update     → cambios (score/eventos)
 *   event: finished   → el partido terminó; el cliente cierra
 *   event: keepalive  → mantener viva la conexión
 *   event: timeout    → corte por duración máxima
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { db } from '@sports/db';
import { logger } from '@sports/logger';

export const matchStreamRouter = new Hono();

// ─── Configuración ────────────────────────────────────────────────────────────
const POLL_INTERVAL_MS       = 15_000;
const KEEPALIVE_INTERVAL_MS   = 25_000;
const MAX_STREAM_DURATION_MS  = 30 * 60 * 1_000;
const MAX_CONNECTIONS = Number(process.env['SSE_MAX_CONNECTIONS'] ?? 1000);

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface MatchRow {
  id: string; season_id: string; round_id: string | null;
  home_score: number | null; away_score: number | null; status: string;
  scheduled_at: string | null; started_at: string | null; finished_at: string | null;
  home_team_id: string; home_team_name: string; home_team_short_name: string | null; home_team_logo_url: string | null;
  away_team_id: string; away_team_name: string; away_team_short_name: string | null; away_team_logo_url: string | null;
}
interface EventRow {
  id: string; event_type: string; minute: number | null; period: number | null;
  team_id: string | null; detail: string | null; player_id: string | null;
  player_first_name: string | null; player_last_name: string | null;
}

// ─── Query helpers (sin cambios funcionales) ────────────────────────────────────

async function fetchMatchSnapshot(matchId: string) {
  const matchResult = await db.query<MatchRow>(`
    SELECT
      m.id, m.season_id, m.round_id,
      m.home_score, m.away_score, m.status,
      m.scheduled_at, m.started_at, m.finished_at,
      ht.id AS home_team_id, ht.name AS home_team_name,
      ht.short_name AS home_team_short_name, ht.logo_url AS home_team_logo_url,
      at.id AS away_team_id, at.name AS away_team_name,
      at.short_name AS away_team_short_name, at.logo_url AS away_team_logo_url
    FROM matches m
    LEFT JOIN teams ht ON ht.id = m.home_team_id
    LEFT JOIN teams at ON at.id = m.away_team_id
    WHERE m.id = $1
  `, [matchId]);

  const row = matchResult.rows[0];
  if (!row) return null;

  const nowMs = Date.now();
  const startMs = row.scheduled_at ? new Date(row.scheduled_at).getTime() : null;
  const terminalStatuses = new Set(['finished', 'postponed', 'cancelled']);
  const effectiveStatus = terminalStatuses.has(row.status)
    ? row.status
    : (row.status === 'live' || (startMs !== null && nowMs >= startMs))
      ? 'live'
      : row.status;

  const eventsResult = await db.query<EventRow>(`
    SELECT
      e.id, e.event_type, e.minute, e.period,
      e.team_id, e.detail, e.player_id,
      p.first_name AS player_first_name, p.last_name AS player_last_name
    FROM match_events e
    LEFT JOIN players p ON p.id = e.player_id
    WHERE e.match_id = $1
    ORDER BY COALESCE(e.period, 99) ASC, COALESCE(e.minute, 9999) ASC, e.created_at ASC
  `, [matchId]);

  const homeTeamId = row.home_team_id;
  const mappedEvents = eventsResult.rows.map((e) => ({
    eventType: e.event_type, teamId: e.team_id, isHomeTeam: e.team_id === homeTeamId,
  }));
  const stats = {
    homeFouls: mappedEvents.filter((e) => e.eventType === 'blue_card' && e.isHomeTeam).length,
    awayFouls: mappedEvents.filter((e) => e.eventType === 'blue_card' && !e.isHomeTeam && e.teamId !== null).length,
    homePenalties: { total: mappedEvents.filter((e) => e.eventType === 'penalty' && e.isHomeTeam).length, scored: 0 },
    awayPenalties: { total: mappedEvents.filter((e) => e.eventType === 'penalty' && !e.isHomeTeam && e.teamId !== null).length, scored: 0 },
  };

  // Alineaciones — paridad con el REST (/matches/:id) para que el directo no
  // las pierda al reemplazar el cliente sus datos con el snapshot del stream.
  const lineupsResult = await db.query<{
    is_home: boolean; jersey_number: number | null; player_name: string;
    is_goalkeeper: boolean; is_starter: boolean; is_captain: boolean;
    goals: number; assists: number; player_id: string | null; photo_url: string | null;
  }>(`
    SELECT ml.is_home, ml.jersey_number, ml.player_name, ml.player_id,
           ml.is_goalkeeper, ml.is_starter, ml.is_captain, ml.goals, ml.assists,
           p.photo_url
    FROM match_lineups ml
    LEFT JOIN players p ON p.id = ml.player_id
    WHERE ml.match_id = $1
      AND ml.role IS NULL
    ORDER BY ml.is_home DESC, ml.is_starter DESC, ml.jersey_number ASC NULLS LAST
  `, [matchId]);
  const toLineup = (r: typeof lineupsResult.rows[number]) => ({
    jerseyNumber: r.jersey_number, playerName: r.player_name,
    isGoalkeeper: r.is_goalkeeper, isStarter: r.is_starter, isCaptain: r.is_captain,
    goals: r.goals, assists: r.assists, playerId: r.player_id, photoUrl: r.photo_url,
  });
  const lineups = {
    home: lineupsResult.rows.filter((r) => r.is_home).map(toLineup),
    away: lineupsResult.rows.filter((r) => !r.is_home).map(toLineup),
  };

  return {
    stats,
    match: {
      id: row.id, seasonId: row.season_id, roundId: row.round_id,
      status: effectiveStatus, scheduledAt: row.scheduled_at,
      startedAt: row.started_at, finishedAt: row.finished_at,
      score: { home: row.home_score, away: row.away_score },
      homeTeam: { id: row.home_team_id, name: row.home_team_name, shortName: row.home_team_short_name, logoUrl: row.home_team_logo_url },
      awayTeam: { id: row.away_team_id, name: row.away_team_name, shortName: row.away_team_short_name, logoUrl: row.away_team_logo_url },
    },
    events: eventsResult.rows.map((e) => ({
      id: e.id, eventType: e.event_type, minute: e.minute, period: e.period,
      teamId: e.team_id, isHomeTeam: e.team_id === homeTeamId, detail: e.detail,
      player: e.player_id ? { id: e.player_id, firstName: e.player_first_name ?? '', lastName: e.player_last_name ?? '' } : null,
    })),
    lineups,
    updatedAt: new Date().toISOString(),
  };
}

// ─── Hub: un poller por partido, fan-out a N suscriptores ───────────────────────

type Kind = 'data' | 'finished' | 'error';
type Subscriber = (json: string, kind: Kind) => void;

interface Hub {
  subscribers: Set<Subscriber>;
  timer: ReturnType<typeof setInterval> | null;
  lastEventCount: number;
  lastHome: number | null;
  lastAway: number | null;
  lastSnapshotJson: string | null;
}

const hubs = new Map<string, Hub>();

function fanout(hub: Hub, json: string, kind: Kind) {
  for (const cb of hub.subscribers) {
    try { cb(json, kind); } catch { /* el wrapper de cada conexión se limpia solo */ }
  }
}

function stopHub(matchId: string) {
  const hub = hubs.get(matchId);
  if (!hub) return;
  if (hub.timer) clearInterval(hub.timer);
  hubs.delete(matchId);
}

async function pollHub(matchId: string) {
  const hub = hubs.get(matchId);
  if (!hub) return;
  let snapshot: Awaited<ReturnType<typeof fetchMatchSnapshot>>;
  try {
    snapshot = await fetchMatchSnapshot(matchId);
  } catch (err) {
    logger.warn({ matchId, err }, 'SSE poll error');
    return; // reintentamos en el siguiente tick
  }
  if (!snapshot) {
    fanout(hub, JSON.stringify({ message: 'Partido no encontrado' }), 'error');
    stopHub(matchId);
    return;
  }

  const evChanged = snapshot.events.length !== hub.lastEventCount;
  const scoreChanged = snapshot.match.score.home !== hub.lastHome || snapshot.match.score.away !== hub.lastAway;
  const first = hub.lastSnapshotJson === null;
  hub.lastEventCount = snapshot.events.length;
  hub.lastHome = snapshot.match.score.home;
  hub.lastAway = snapshot.match.score.away;
  const json = JSON.stringify(snapshot);
  hub.lastSnapshotJson = json;

  if (first || evChanged || scoreChanged) fanout(hub, json, 'data');

  if (snapshot.match.status === 'finished') {
    fanout(hub, JSON.stringify({ matchId, finishedAt: snapshot.match.finishedAt }), 'finished');
    stopHub(matchId);
  }
}

function subscribe(matchId: string, cb: Subscriber) {
  let hub = hubs.get(matchId);
  if (!hub) {
    hub = { subscribers: new Set(), timer: null, lastEventCount: -1, lastHome: -1, lastAway: -1, lastSnapshotJson: null };
    hubs.set(matchId, hub);
    hub.timer = setInterval(() => { void pollHub(matchId); }, POLL_INTERVAL_MS);
    void pollHub(matchId); // primer poll inmediato
  }
  hub.subscribers.add(cb);
  // Si ya hay snapshot en caché, lo entregamos al recién llegado al instante.
  if (hub.lastSnapshotJson) cb(hub.lastSnapshotJson, 'data');
}

function unsubscribe(matchId: string, cb: Subscriber) {
  const hub = hubs.get(matchId);
  if (!hub) return;
  hub.subscribers.delete(cb);
  if (hub.subscribers.size === 0) stopHub(matchId);
}

// ─── Endpoint SSE ─────────────────────────────────────────────────────────────

let activeConnections = 0;

matchStreamRouter.get('/:id/stream', async (c) => {
  const matchId = c.req.param('id');

  if (activeConnections >= MAX_CONNECTIONS) {
    return c.json({ error: 'too_many_connections' }, 503);
  }

  const origin = process.env['WEB_BASE_URL'];
  if (origin) c.header('Access-Control-Allow-Origin', origin); // sin fallback a '*'
  c.header('Cache-Control', 'no-cache');
  c.header('X-Accel-Buffering', 'no');

  activeConnections++;

  return streamSSE(c, async (stream) => {
    const startedAt = Date.now();
    const queue: Array<{ json: string; ev: string }> = [];
    let wake: (() => void) | null = null;
    let firstSent = false;
    let done = false;

    const onData: Subscriber = (json, kind) => {
      let ev: string;
      if (kind === 'error') ev = 'error';
      else if (kind === 'finished') ev = 'finished';
      else { ev = firstSent ? 'update' : 'snapshot'; firstSent = true; }
      queue.push({ json, ev });
      wake?.();
    };

    subscribe(matchId, onData);

    try {
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
      activeConnections--;
    }
  });
});

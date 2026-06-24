/**
 * Orquestador de scraping en vivo con backoff inteligente.
 *
 * Diseñado para ser invocado por un cron externo cada 5 minutos.
 * El script mismo decide si hay trabajo que hacer:
 *
 *   · Si NO hay partidos live ni empezando en <2 h → sale en <1 s (coste mínimo).
 *   · Si SÍ hay actividad → entra en bucle de polling cada POLL_INTERVAL_S
 *     y no sale hasta que todos los partidos activos sean 'finished'.
 *
 * Multi-season: en lugar de un único SEASON_ID, el cron consulta
 * automáticamente TODAS las temporadas con is_current=true en DB,
 * más cualquier ID configurado en SEASON_ID (retrocompatibilidad).
 * Esto garantiza que playoffs y copas con season UUID propio se monitoricen.
 *
 * Uso:
 *   npx tsx --env-file=.env apps/etl/src/cron-live.ts
 *
 * Variables de entorno:
 *   SEASON_ID          — UUID de temporada adicional (retrocompat, opcional)
 *   SEASON_IDS         — UUIDs adicionales separados por coma (opcional)
 *   POLL_INTERVAL_S    — segundos entre ciclos en modo activo (defecto: 45)
 *   WINDOW_HOURS       — horas hacia adelante para buscar partidos próximos (defecto: 2)
 *   MAX_RUNTIME_MIN    — minutos máximos antes de salir por seguridad (defecto: 180)
 */
import './instrument.js'; // Sentry.init — debe ir el PRIMERO de todo
import * as Sentry from '@sentry/node';
import { createLogger } from '@sports/logger';
import { db, closeDb } from '@sports/db';
import { EtlPipeline } from './pipeline.js';
import { deriveMatchResults } from './derive-results.js';
import { FepMatchesScraper } from '../../scraper/src/scrapers/fep/fep-matches.scraper.js';
import { FepFichaScraper } from '../../scraper/src/scrapers/fep/fep-ficha.scraper.js';
import {
  snapshotMatches, snapshotRounds, snapshotGoals, snapshotPlayerEventCounts,
  snapshotExtraPhases, snapshotResults,
  diffAndNotify, diffGoals, diffCardOrFoul, diffBlueAndFouls,
  diffOvertimePenalties, diffResolution, flushPushAnalytics, pushEnabled,
} from './push-dispatcher.js';

const log = createLogger({ service: 'cron-live' });

// Fallos consecutivos del scrape de marcadores: solo alertamos a Sentry tras
// varios seguidos (un blip de red aislado se recupera al ciclo siguiente).
const MC_FAIL_ALERT_THRESHOLD = 3;
let consecutiveMcFailures = 0;

const POLL_INTERVAL  = Number(process.env['POLL_INTERVAL_S']  ?? 45) * 1000;
const WINDOW_HOURS   = Number(process.env['WINDOW_HOURS']     ?? 2);
const MAX_RUNTIME_MS = Number(process.env['MAX_RUNTIME_MIN']  ?? 180) * 60 * 1000;
const SPORT_SLUG     = 'hockey-patines';

// ── Sentry Cron Monitor (heartbeat) ──────────────────────────────────────────
// Detecta si el cron deja de correr del todo (contenedor/scheduler muerto). Como
// en partido el cron entra en un bucle largo, no vale un check-in por invocación:
// latimos al arrancar Y en cada ciclo, así Sentry nos ve vivos siempre (≤5 min
// entre latidos) y solo alerta si de verdad se cae.
const CRON_MONITOR_SLUG = 'cron-live-hockey';
const CRON_MONITOR_CONFIG = {
  schedule: { type: 'interval' as const, value: 5, unit: 'minute' as const },
  checkinMargin: 5, // minutos de gracia antes de marcar "perdido"
  maxRuntime: 200,  // minutos (el bucle activo puede durar hasta 180)
  timezone: 'Etc/UTC',
};
function heartbeat(): void {
  try { Sentry.captureCheckIn({ monitorSlug: CRON_MONITOR_SLUG, status: 'ok' }, CRON_MONITOR_CONFIG); }
  catch { /* nunca romper el cron por el monitor */ }
}

interface WindowStatus {
  hasLive:     boolean;  // al menos un partido con status='live'
  hasUpcoming: boolean;  // al menos un partido 'scheduled' en las próximas WINDOW_HOURS
  hasOverdue:  boolean;  // partidos cuya hora ya pasó (últimas 48h) sin estado final
}

/**
 * Resuelve el conjunto de IDs de temporada a monitorizar:
 *   1. Todas las seasons con is_current=true en DB.
 *   2. Cualquier ID configurado en SEASON_ID / SEASON_IDS (retrocompat).
 * El resultado se deduplica.
 */
async function resolveSeasonIds(): Promise<string[]> {
  const configured = [
    ...(process.env['SEASON_IDS'] ?? '').split(','),
    ...(process.env['SEASON_ID']  ?? '').split(','),
  ].map(s => s.trim()).filter(Boolean);

  const res = await db.query<{ id: string }>(
    `SELECT id FROM seasons WHERE is_current = true`
  );
  const fromDb = res.rows.map(r => r.id);

  const all = [...new Set([...fromDb, ...configured])];
  return all;
}

/**
 * Consulta rápida: ¿hay actividad en la ventana de tiempo?
 * Opera sobre TODAS las temporadas activas a la vez (ANY($1)).
 */
async function checkWindow(seasonIds: string[]): Promise<WindowStatus> {
  const [liveRes, upcomingRes, overdueRes] = await Promise.all([
    db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM matches
       WHERE season_id = ANY($1) AND status = 'live'`,
      [seasonIds]
    ),
    db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM matches
       WHERE season_id    = ANY($1)
         AND status       = 'scheduled'
         AND scheduled_at BETWEEN NOW() AND NOW() + INTERVAL '${WINDOW_HOURS} hours'`,
      [seasonIds]
    ),
    // Partidos zombi: su hora pasó pero siguen sin estado final.
    db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM matches
       WHERE season_id    = ANY($1)
         AND status       IN ('scheduled', 'live')
         AND scheduled_at BETWEEN NOW() - INTERVAL '48 hours' AND NOW()`,
      [seasonIds]
    ),
  ]);

  return {
    hasLive:     Number(liveRes.rows[0]?.count     ?? 0) > 0,
    hasUpcoming: Number(upcomingRes.rows[0]?.count  ?? 0) > 0,
    hasOverdue:  Number(overdueRes.rows[0]?.count   ?? 0) > 0,
  };
}

/**
 * Descarga y persiste la ficha resumen (eventos, alineaciones, faltas) de todos
 * los partidos que están live o que terminaron recientemente sin tener eventos.
 * Opera sobre TODAS las temporadas activas.
 */
async function runFichasForActiveMatches(seasonIds: string[]): Promise<void> {
  const rows = await db.query<{
    id: string;
    source_ref: string;
    comp_ref: string | null;
    home_team_name: string | null;
  }>(
    `SELECT m.id, m.source_ref, comp.source_ref AS comp_ref, ht.name AS home_team_name
     FROM matches m
     JOIN seasons s ON s.id = m.season_id
     JOIN competitions comp ON comp.id = s.competition_id
     LEFT JOIN teams ht ON ht.id = m.home_team_id
     WHERE m.season_id = ANY($1)
       AND m.source_ref LIKE 'fep_match_%'
       AND (
         -- Partidos en directo: siempre actualizar eventos
         m.status = 'live'
         OR (
           -- Partidos recién terminados (3h) sin ningún evento persistido.
           -- Guardia: solo los jugados en las últimas 48h. Evita perseguir en
           -- bucle la ficha (404) de partidos viejos que la fuente sigue
           -- listando en el feed mc (p.ej. incomparecencias antiguas 0-10).
           m.status = 'finished'
           AND m.updated_at   > NOW() - INTERVAL '3 hours'
           AND m.scheduled_at > NOW() - INTERVAL '48 hours'
           AND NOT EXISTS (SELECT 1 FROM match_events me WHERE me.match_id = m.id)
         )
       )`,
    [seasonIds]
  );

  if (rows.rows.length === 0) return;

  log.info({ count: rows.rows.length }, 'Procesando fichas para partidos activos/recientes');

  for (const match of rows.rows) {
    const idp = match.source_ref.replace('fep_match_', '');
    const idc = (match.comp_ref ?? '').replace(/^fep_competition_/, '');

    if (!idc) {
      log.warn({ matchId: match.id, idp }, 'idc vacio — omitiendo ficha de este partido');
      continue;
    }

    try {
      const scraper = new FepFichaScraper({
        idp,
        idc,
        ...(match.home_team_name ? { homeTeamName: match.home_team_name } : {}),
        matchId: match.id,
      });
      await scraper.run();
      log.debug({ matchId: match.id, idp, idc }, 'Ficha procesada');
    } catch (err) {
      log.warn({ err, matchId: match.id, idp, idc }, 'Error en ficha — continuando con siguiente partido');
    }

    // Cortesia con el servidor fuente
    await new Promise((r) => setTimeout(r, 1_000));
  }
}

/**
 * Un ciclo de scraping: captura marcadores, los persiste y luego descarga
 * las fichas resumen de los partidos activos.
 */
/** Temporadas (≠ primaria) con actividad: live o partido inminente en la ventana. */
async function activeSecondarySeasons(seasonIds: string[], primarySeasonId: string): Promise<string[]> {
  const res = await db.query<{ season_id: string }>(
    `SELECT DISTINCT season_id FROM matches
     WHERE season_id = ANY($1) AND season_id <> $2
       AND ( status = 'live'
          OR (status = 'scheduled'
              AND scheduled_at BETWEEN NOW() - INTERVAL '3 hours'
                                   AND NOW() + INTERVAL '${WINDOW_HOURS} hours') )`,
    [seasonIds, primarySeasonId]
  );
  return res.rows.map((r) => r.season_id);
}

/**
 * Scrapea los marcadores de UNA temporada y dispara el push de eventos de partido
 * (inicio/gol/final) + jornada + competición. No emite gol-jugador (eso queda para
 * la primaria, que tiene el timing fino con las fichas).
 */
async function scrapeSeasonScores(seasonId: string): Promise<void> {
  const prev       = pushEnabled ? await snapshotMatches(seasonId) : new Map();
  const prevRounds = pushEnabled ? await snapshotRounds(seasonId)  : new Map();
  const scraper  = new FepMatchesScraper({ seasonId });
  const pipeline = new EtlPipeline({ sportSlug: SPORT_SLUG, seasonId });
  const result = await scraper.run();
  if (result.data.length === 0) return;
  await pipeline.runMatches(result);
  try { await diffAndNotify(prev, prevRounds, seasonId); } catch (err) {
    log.warn({ err, seasonId }, 'push (secundaria) fallo — sigue');
  }
}

async function runOneCycle(seasonIds: string[], primarySeasonId: string): Promise<number> {
  const scraper  = new FepMatchesScraper({ seasonId: primarySeasonId });
  const pipeline = new EtlPipeline({ sportSlug: SPORT_SLUG, seasonId: primarySeasonId });

  // Snapshot previo (partidos + jornadas) para push antes de scrapear marcadores
  const prev       = pushEnabled ? await snapshotMatches(primarySeasonId) : new Map();
  const prevRounds = pushEnabled ? await snapshotRounds(primarySeasonId)  : new Map();

  const result = await scraper.run();
  if (result.data.length === 0) {
    // rfep_mc_1.php normalmente devuelve decenas de partidos. 0 = la fuente cayó,
    // cambió de estructura o nos bloqueó. Pero un fallo de red AISLADO (sidgad ya
    // reintenta 3×) se recupera al ciclo siguiente (45s): no es una incidencia.
    // Solo escalamos a Sentry como ERROR si FALLA VARIOS CICLOS SEGUIDOS; uno
    // suelto queda como warning/breadcrumb para no generar ruido.
    if (!result.success) {
      consecutiveMcFailures++;
      if (consecutiveMcFailures >= MC_FAIL_ALERT_THRESHOLD) {
        Sentry.captureException(
          new Error(`Scraper de marcadores falló ${consecutiveMcFailures} ciclos seguidos`),
          { tags: { phase: 'mc-scrape' }, extra: { errors: result.errors } });
      } else {
        log.warn({ errors: result.errors, consecutiveMcFailures },
          'Scraper de marcadores falló (transitorio) — reintento en el próximo ciclo');
      }
    } else {
      // 200 OK pero 0 partidos: huele a cambio de estructura de la fuente.
      Sentry.captureMessage('rfep_mc_1.php devolvió 0 partidos — posible cambio/caída de la fuente', 'warning');
    }
    return 0;
  }
  // Ciclo con datos: la fuente responde, reseteamos el contador de fallos.
  consecutiveMcFailures = 0;

  const etl = await pipeline.runMatches(result);

  // Eventos de partido (equipo/competición) + jornada (inicio/fin)
  try { await diffAndNotify(prev, prevRounds, primarySeasonId); } catch (err) {
    log.warn({ err }, 'push-dispatcher fallo — el scraping sigue');
  }

  // ── Marcadores de las DEMÁS competiciones con actividad (aditivo) ──────────
  // El directo de la primaria (OK Liga) ya está hecho arriba; aquí cubrimos el
  // resto de competiciones en vivo. Aislado: si una falla, no afecta a nada más.
  // Las fichas/alineaciones de sus partidos se refrescan después, abajo, porque
  // runFichasForActiveMatches opera sobre TODAS las temporadas.
  try {
    for (const sid of await activeSecondarySeasons(seasonIds, primarySeasonId)) {
      try { await scrapeSeasonScores(sid); } catch (err) {
        log.warn({ err, seasonId: sid }, 'scores secundaria fallo — continúa');
      }
      await sleep(1000); // cortesía con la fuente
    }
  } catch (err) {
    log.warn({ err }, 'pase de competiciones secundarias fallo — primaria intacta');
  }

  // Goles: las fichas traen goleador y minuto, así que snapshot ANTES de
  // refrescarlas y diff DESPUÉS, sobre TODAS las temporadas activas.
  const prevGoals = pushEnabled ? await snapshotGoals(seasonIds) : new Map();
  const prevReds  = pushEnabled ? await snapshotPlayerEventCounts(seasonIds, 'red_card') : new Map();
  const prevBlues = pushEnabled ? await snapshotPlayerEventCounts(seasonIds, 'blue_card') : new Map();
  const prevFouls = pushEnabled ? await snapshotPlayerEventCounts(seasonIds, 'direct_foul') : new Map();
  // Prórroga/penaltis: las fichas escriben live_period y el marcador de la tanda,
  // así que snapshot ANTES y diff DESPUÉS (igual que goles).
  const prevPhase   = pushEnabled ? await snapshotExtraPhases(seasonIds) : new Map();
  const prevResults = pushEnabled ? await snapshotResults(seasonIds)     : new Map();
  try {
    await runFichasForActiveMatches(seasonIds);
  } catch (err) {
    log.warn({ err }, 'runFichasForActiveMatches fallo — ciclo de scores sigue OK');
  }
  try { await diffGoals(prevGoals, seasonIds); } catch (err) {
    log.warn({ err }, 'push de gol fallo — el ciclo sigue');
  }
  try { await diffCardOrFoul(prevReds, seasonIds, 'red_card'); } catch (err) {
    log.warn({ err }, 'push de expulsion fallo — el ciclo sigue');
  }
  // Azul + falta directa juntas: una azul y la FD del mismo instante se agrupan.
  try { await diffBlueAndFouls(prevBlues, prevFouls, seasonIds); } catch (err) {
    log.warn({ err }, 'push de azul/falta directa fallo — el ciclo sigue');
  }
  // Deriva reglamentario/prórroga/win_type de los finalizados (la tanda y su
  // ganador los pone la ficha; aquí se conserva).
  try { await deriveMatchResults(seasonIds); } catch (err) {
    log.warn({ err }, 'derive-results fallo — el ciclo sigue');
  }
  // Inicio de prórroga/penaltis en vivo.
  try { await diffOvertimePenalties(prevPhase, seasonIds); } catch (err) {
    log.warn({ err }, 'push de prórroga/penaltis fallo — el ciclo sigue');
  }
  // Final por tipo (reemplaza el final genérico vía mismo tag).
  try { await diffResolution(prevResults, seasonIds); } catch (err) {
    log.warn({ err }, 'push de final por tipo fallo — el ciclo sigue');
  }

  return etl.upserted;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  heartbeat(); // latido al monitor: "el cron arrancó"

  // ── 0. Resolver temporadas activas ────────────────────────────────────────
  const seasonIds = await resolveSeasonIds();

  if (seasonIds.length === 0) {
    log.error('No se encontraron temporadas activas (is_current=true) ni SEASON_ID configurado.');
    process.exit(1);
  }

  // La temporada "primaria" es la primera configurada explicitamente, o la primera de DB.
  const primarySeasonId = (process.env['SEASON_ID'] ?? '').trim() || seasonIds[0]!;

  log.info({ seasonIds, primarySeasonId }, 'Temporadas monitorizadas');

  // ── 1. Check de ventana ────────────────────────────────────────────────────
  const initial = await checkWindow(seasonIds);

  if (!initial.hasLive && !initial.hasUpcoming) {
    if (initial.hasOverdue) {
      log.info('Partidos atrasados sin resultado — ciclo de recuperacion');
      const upserted = await runOneCycle(seasonIds, primarySeasonId);
      log.info({ upserted }, 'Recuperacion completada — saliendo.');
      return;
    }
    log.info(
      { windowHours: WINDOW_HOURS, seasonIds },
      'Sin partidos live ni proximos — saliendo sin trabajo.'
    );
    return;
  }

  // ── 2. Modo activo: bucle de polling ───────────────────────────────────────
  const startedAt = Date.now();
  log.info(
    { hasLive: initial.hasLive, hasUpcoming: initial.hasUpcoming, pollIntervalS: POLL_INTERVAL / 1000 },
    'Actividad detectada — iniciando polling'
  );

  let cycle = 0;

  while (true) {
    cycle++;
    heartbeat(); // latido en cada ciclo: mantiene el monitor vivo en partidos largos
    const elapsed = Date.now() - startedAt;

    if (elapsed > MAX_RUNTIME_MS) {
      log.warn({ elapsedMin: Math.round(elapsed / 60_000) }, 'Tiempo maximo alcanzado — saliendo.');
      break;
    }

    const cycleStart = Date.now();
    try {
      const upserted = await runOneCycle(seasonIds, primarySeasonId);
      log.info(
        { cycle, upserted, durationMs: Date.now() - cycleStart },
        'Ciclo completado'
      );
    } catch (err) {
      log.error({ cycle, err }, 'Error en ciclo — reintentando en siguiente tick');
      Sentry.captureException(err, { tags: { phase: 'cron-cycle' }, extra: { cycle } });
    }

    const status = await checkWindow(seasonIds);

    if (!status.hasLive && !status.hasUpcoming) {
      log.info({ cycle }, 'Todos los partidos finalizados — ciclo final de fichas y saliendo.');
      try {
        await runFichasForActiveMatches(seasonIds);
      } catch (err) {
        log.warn({ err }, 'Ciclo final de fichas con error');
      }
      break;
    }

    log.debug(
      { hasLive: status.hasLive, hasUpcoming: status.hasUpcoming, nextInMs: POLL_INTERVAL },
      'Proximo ciclo...'
    );
    await sleep(POLL_INTERVAL);
  }

  log.info({ totalCycles: cycle, totalMin: Math.round((Date.now() - startedAt) / 60_000) }, 'Orquestador terminado');
}

main()
  .catch((err) => { log.error({ err }, 'Error fatal'); Sentry.captureException(err); process.exitCode = 1; })
  // flush ANTES de salir: el cron es un proceso corto y si no se pierden los eventos
  .finally(async () => { await flushPushAnalytics(); await Sentry.flush(2000); await closeDb(); });

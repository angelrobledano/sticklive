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
import { forEachLimited } from './concurrency.js';
import { deriveMatchResults } from './derive-results.js';
import { sweepStaleLive } from './stale-live-watchdog.js';
import { checkWindow } from './live-window.js';
import { touchAlive } from './heartbeat-file.js';
import { FepMatchesScraper } from '../../scraper/src/scrapers/fep/fep-matches.scraper.js';
import { FepFichaScraper } from '../../scraper/src/scrapers/fep/fep-ficha.scraper.js';
import { resolveWorldskate, runWorldskate } from '../../scraper/src/scrapers/worldskate/run-worldskate.js';
import {
  sourceForMatchRef, idpFromMatchRef, idcFromCompetitionRef,
} from '../../scraper/src/core/sources.js';
import {
  snapshotMatches, snapshotRounds, snapshotGoals, snapshotEventsByType,
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
// Fichas en paralelo dentro de un ciclo de directo. Un tope moderado acorta el
// ciclo cuando hay muchos partidos en juego a la vez (más ligas) sin martillear.
const FICHA_CONCURRENCY = Number(process.env['FICHA_CONCURRENCY'] ?? 3);

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
// Latido doble: al monitor de Sentry (muerte del cron) y al FICHERO que mira el
// healthcheck del contenedor (#146). El segundo es el que evita el falso
// `unhealthy` durante un directo largo: el scheduler solo toca el fichero entre
// vueltas, así que sin este toque interno un ETL OCUPADO parecía colgado.
function heartbeat(): void {
  touchAlive();
  try { Sentry.captureCheckIn({ monitorSlug: CRON_MONITOR_SLUG, status: 'ok' }, CRON_MONITOR_CONFIG); }
  catch { /* nunca romper el cron por el monitor */ }
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
       -- Sin filtro por fuente: hasta el 20/07/2026 aquí había un
       -- \`LIKE 'fep_match_%'\` que descartaba en silencio todo lo que no fuera
       -- de la FEP. Efecto práctico: World Skate nunca tuvo cronología ni
       -- crono, sólo marcador. Ahora se resuelve la fuente por prefijo y se
       -- omite únicamente lo que no sabemos tratar (ver core/sources.ts).
       AND m.source_ref IS NOT NULL
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

  log.info({ count: rows.rows.length, concurrency: FICHA_CONCURRENCY }, 'Procesando fichas para partidos activos/recientes');

  await forEachLimited(rows.rows, FICHA_CONCURRENCY, async (match) => {
    const source = sourceForMatchRef(match.source_ref);
    if (!source) {
      log.debug(
        { matchId: match.id, sourceRef: match.source_ref },
        'Fuente no reconocida — omitiendo ficha (añádela en core/sources.ts)'
      );
      return;
    }

    const idp = idpFromMatchRef(match.source_ref, source);
    const idc = idcFromCompetitionRef(match.comp_ref, source);

    if (!idp || !idc) {
      log.warn(
        { matchId: match.id, sourceRef: match.source_ref, compRef: match.comp_ref, source: source.key },
        'idp o idc vacios — omitiendo ficha de este partido'
      );
      return;
    }

    try {
      const scraper = new FepFichaScraper({
        idp,
        idc,
        source,
        ...(match.home_team_name ? { homeTeamName: match.home_team_name } : {}),
        matchId: match.id,
      });
      await scraper.run();
      log.debug({ matchId: match.id, idp, idc, source: source.key }, 'Ficha procesada');
    } catch (err) {
      log.warn({ err, matchId: match.id, idp, idc, source: source.key }, 'Error en ficha — continuando con siguiente partido');
    }
  });
}

/**
 * Temporadas de la FEP (cualquier competición `fep_%`) con actividad: live o
 * partido inminente en la ventana. De éstas se hace snapshot→diff para el push.
 * El feed rfep_mc_1 es de la FEP; World Skate va aparte (runWorldskateScores).
 */
async function activeFepSeasons(seasonIds: string[]): Promise<string[]> {
  const res = await db.query<{ season_id: string }>(
    `SELECT DISTINCT m.season_id FROM matches m
     JOIN seasons s      ON s.id = m.season_id
     JOIN competitions c ON c.id = s.competition_id
     WHERE m.season_id = ANY($1)
       AND c.source_ref LIKE 'fep_%'
       AND ( m.status = 'live'
          OR (m.status = 'scheduled'
              AND m.scheduled_at BETWEEN NOW() - INTERVAL '3 hours'
                                     AND NOW() + make_interval(hours => $2::int)) )`,
    [seasonIds, WINDOW_HOURS]
  );
  return res.rows.map((r) => r.season_id);
}

/**
 * Marcadores de la FEP. `rfep_mc_1.php` es un feed GLOBAL: un solo POST trae los
 * partidos en juego de TODAS las competiciones. Antes se scrapeaba por la
 * temporada "primaria" y se RE-SCRAPEABA el mismo feed una vez por cada
 * competición secundaria activa, sólo para hacer su diff de push. Ahora:
 * snapshot de las FEP activas → UN scrape → diff de todas. Menos carga sobre
 * sidgad y sin temporadas de segunda: todas emiten los mismos avisos.
 *
 * Separado de `runOneCycle` a propósito: si `rfep_mc_1.php` devuelve 0 no debe
 * abortar el ciclo (las fichas y World Skate operan sobre todas las fuentes).
 *
 * Devuelve cuántos partidos se actualizaron (0 si la fuente no dio nada).
 */
async function runFepScores(seasonIds: string[]): Promise<number> {
  // Temporadas FEP con actividad: de éstas hacemos snapshot→diff para el push.
  const activeSeasons = await activeFepSeasons(seasonIds);

  // Snapshot ANTES del scrape (partidos + jornadas), por temporada activa.
  const prevByS = new Map<string, {
    matches: Awaited<ReturnType<typeof snapshotMatches>>;
    rounds: Awaited<ReturnType<typeof snapshotRounds>>;
  }>();
  if (pushEnabled) {
    for (const sid of activeSeasons) {
      prevByS.set(sid, { matches: await snapshotMatches(sid), rounds: await snapshotRounds(sid) });
    }
  }

  // UN scrape del feed global. El seasonId es sólo fallback para partidos que el
  // calendario aún no cargó; para los existentes, el upsert preserva su season_id.
  const seasonFallback = activeSeasons[0] ?? seasonIds[0]!;
  const scraper  = new FepMatchesScraper({ seasonId: seasonFallback });
  const pipeline = new EtlPipeline({ sportSlug: SPORT_SLUG, seasonId: seasonFallback, requireTeamsInSeason: true, stampLiveTimes: true });

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
    } else if (activeSeasons.length > 0) {
      // 200 OK pero 0 partidos habiendo FEP con actividad esperada: sospechoso.
      // (Fuera de temporada FEP el feed devuelve 0 legítimamente y no alertamos.)
      Sentry.captureMessage('rfep_mc_1.php devolvió 0 partidos habiendo partidos FEP en juego — posible cambio/caída de la fuente', 'warning');
    } else {
      log.debug('rfep_mc_1.php sin partidos y sin actividad FEP esperada — normal fuera de temporada');
    }
    return 0;
  }
  // Ciclo con datos: la fuente responde, reseteamos el contador de fallos.
  consecutiveMcFailures = 0;

  const etl = await pipeline.runMatches(result);

  // Push (inicio/gol/final + jornada + competición) para TODAS las FEP activas,
  // desde el snapshot tomado antes del único scrape.
  if (pushEnabled) {
    for (const sid of activeSeasons) {
      const prev = prevByS.get(sid);
      if (!prev) continue;
      try { await diffAndNotify(prev.matches, prev.rounds, sid); } catch (err) {
        log.warn({ err, seasonId: sid }, 'push-dispatcher fallo — el scraping sigue');
      }
    }
  }

  return etl.upserted;
}

/**
 * Marcadores de World Skate, con el mismo snapshot→diff que las secundarias de
 * la FEP para que el push de inicio/gol/final funcione igual.
 *
 * Está AQUÍ, dentro del ciclo de 45 s, y no sólo en `etl-scheduler.sh`, porque
 * el bucle del scheduler es secuencial: mientras `cron-live` está en su bucle
 * activo (hasta MAX_RUNTIME_MIN, 180 por defecto) no le llega el turno a nada
 * de lo que va detrás. Y el estado `live` de World Skate se infiere de la hora
 * y caduca a las 3 h, así que los partidos se quedaban colgados "EN JUEGO":
 * ese `live` fantasma mantenía vivo el bucle, y el bucle impedía la ejecución
 * que lo habría corregido. Metiéndolo aquí, además, el directo de World Skate
 * pasa de 5 minutos de resolución a 45 segundos.
 */
async function runWorldskateScores(): Promise<void> {
  const comps = await resolveWorldskate();
  for (const ctx of comps) {
    const prev       = pushEnabled ? await snapshotMatches(ctx.seasonId) : new Map();
    const prevRounds = pushEnabled ? await snapshotRounds(ctx.seasonId)  : new Map();
    try {
      await runWorldskate(ctx, (seasonId) =>
        new EtlPipeline({ sportSlug: SPORT_SLUG, seasonId, createRounds: true }));
    } catch (err) {
      log.warn({ err, competition: ctx.name }, 'marcadores World Skate fallaron — sigue');
      continue;
    }
    try { await diffAndNotify(prev, prevRounds, ctx.seasonId); } catch (err) {
      log.warn({ err, competition: ctx.name }, 'push (World Skate) fallo — sigue');
    }
  }
}

/**
 * Un ciclo completo: marcadores de TODAS las fuentes (FEP + World Skate) y,
 * después, actas y notificaciones. Cada fuente tiene su propio scraper y va
 * aislada: que una caiga no impide que las demás se actualicen.
 */
async function runOneCycle(seasonIds: string[]): Promise<number> {
  let upserted = 0;
  try {
    upserted = await runFepScores(seasonIds);
  } catch (err) {
    // Que la FEP falle no debe impedir que se refresquen las actas del resto.
    log.warn({ err }, 'marcadores FEP fallaron — el ciclo sigue con las fichas');
  }

  try {
    await runWorldskateScores();
  } catch (err) {
    log.warn({ err }, 'marcadores World Skate fallaron — el ciclo sigue');
  }

  // Goles: las fichas traen goleador y minuto, así que snapshot ANTES de
  // refrescarlas y diff DESPUÉS, sobre TODAS las temporadas activas.
  const prevGoals = pushEnabled ? await snapshotGoals(seasonIds) : new Map();
  const prevReds  = pushEnabled ? await snapshotEventsByType(seasonIds, 'red_card') : new Map();
  const prevBlues = pushEnabled ? await snapshotEventsByType(seasonIds, 'blue_card') : new Map();
  const prevFouls = pushEnabled ? await snapshotEventsByType(seasonIds, 'direct_foul') : new Map();
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

  // Último paso del ciclo, y a propósito: si algo de lo anterior falló y dejó
  // un partido colgado en `live`, esto lo limpia. Ver stale-live-watchdog.ts.
  try { await sweepStaleLive(seasonIds); } catch (err) {
    log.warn({ err }, 'watchdog de live colgados fallo — el ciclo sigue');
  }

  return upserted;
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

  log.info({ seasonIds }, 'Temporadas monitorizadas');

  // ── 1. Check de ventana ────────────────────────────────────────────────
  const initial = await checkWindow(seasonIds, WINDOW_HOURS);

  if (!initial.hasLive && !initial.hasUpcoming) {
    if (initial.hasOverdue) {
      log.info('Partidos atrasados sin resultado — ciclo de recuperacion');
      const upserted = await runOneCycle(seasonIds);
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
      const upserted = await runOneCycle(seasonIds);
      log.info(
        { cycle, upserted, durationMs: Date.now() - cycleStart },
        'Ciclo completado'
      );
    } catch (err) {
      log.error({ cycle, err }, 'Error en ciclo — reintentando en siguiente tick');
      Sentry.captureException(err, { tags: { phase: 'cron-cycle' }, extra: { cycle } });
    }

    const status = await checkWindow(seasonIds, WINDOW_HOURS);

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

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
import { acquireEtlLock } from './etl-lock.js';
import { EtlPipeline } from './pipeline.js';
import { forEachLimited } from './concurrency.js';
import { deriveMatchResults } from './derive-results.js';
import { sweepStaleLive } from './stale-live-watchdog.js';
import { MissingLiveTracker } from './missing-live.js';
import { checkWindow } from './live-window.js';
import { selectFichaCandidates, type FichaCandidate } from './ficha-candidates.js';
import { fichaDue, fichaSignature } from './ficha-due.js';
import { ACTA_POST_STRIKES } from './acta-mode.js';
import { actaFinalCandidates, finalizeByActa, type EndedByActa } from './acta-final.js';
import { touchAlive } from './heartbeat-file.js';
import { loopDecision, LIVE_YIELD_EXIT_CODE } from './live-yield.js';
import { ScrapeFailureTracker } from './scrape-health.js';
import type { ScrapedMatch } from '@sports/shared-types';
import { FepMatchesScraper } from '../../scraper/src/scrapers/fep/fep-matches.scraper.js';
import { FepFichaScraper } from '../../scraper/src/scrapers/fep/fep-ficha.scraper.js';
import {
  resolveWorldskate, runWorldskate, reportDormantWorldskate,
} from '../../scraper/src/scrapers/worldskate/run-worldskate.js';
import {
  sourceForMatchRef, idpFromMatchRef, idcFromCompetitionRef, matchRef, currentSource,
  SOURCES, type SourceDef,
} from '../../scraper/src/core/sources.js';
import { logEgressSummary } from '../../scraper/src/egress/index.js';
// Portugal (FPP): feed /Direto + ficha/timeline de los partidos en juego.
import { runFppLiveScores, fppLiveCandidates } from '../../scraper/src/scrapers/fpp/fpp-live.js';
import { processFppFicha, type FppFichaTarget } from '../../scraper/src/scrapers/fpp/fpp-ficha.js';
// Euskadi + Liga Norte (FVP): feed de marcadores + acta (eventos y crono) de los partidos en juego.
import { runFvpLiveScores, fvpLiveCandidates } from '../../scraper/src/scrapers/fvp/fvp-live.js';
import { processFvpFicha, type FvpFichaTarget } from '../../scraper/src/scrapers/fvp/fvp-ficha.js';
import {
  snapshotMatches, snapshotRounds, snapshotGoals, snapshotEventsByType,
  snapshotExtraPhases, snapshotResults,
  diffAndNotify, diffGoals, diffCardOrFoul, diffBlueAndFouls,
  diffOvertimePenalties, diffResolution, flushPushAnalytics, pushEnabled,
  deliverMorningSummaries,
} from './push-dispatcher.js';

const log = createLogger({ service: 'cron-live' });

// Fallos consecutivos del scrape de marcadores: solo alertamos a Sentry tras
// varios seguidos (un blip de red aislado se recupera al ciclo siguiente).
const MC_FAIL_ALERT_THRESHOLD = 3;
/** Fallos consecutivos del match center, por portal (`fep`, `fecapa`, `fisr`…). */
const consecutiveMcFailures = new Map<string, number>();

// #293: fallos consecutivos por fuente. Mientras una fuente lleve N ciclos
// fallando, el latido del Cron Monitor deja de decir "todo bien" (status
// 'error') para que Sentry avise. El toque del fichero de latido del contenedor
// sigue ocurriendo SIEMPRE: un fallo de una fuente externa NO debe marcar el ETL
// como `unhealthy`.
const SOURCE_FAIL_ALERT_THRESHOLD = Number(process.env['SOURCE_FAIL_ALERT_THRESHOLD'] ?? 3);
const sourceFailures = new ScrapeFailureTracker(SOURCE_FAIL_ALERT_THRESHOLD);
const SK_WORLDSKATE = 'worldskate_hockey';

/**
 * Alimenta el contador de fallos por fuente. Al cruzar el umbral (primera vez en
 * la racha) manda un evento Sentry ERROR con la fuente en el mensaje, además de
 * marcar el latido como 'error' (ver heartbeat).
 */
function noteWorldskateResult(name: string, idc: string, ok: boolean): void {
  if (!sourceFailures.observe(SK_WORLDSKATE, ok)) return;
  Sentry.captureMessage(
    `World Skate falló ${SOURCE_FAIL_ALERT_THRESHOLD} ciclos seguidos (${name}, idc ${idc})`,
    { level: 'error', tags: { source: 'worldskate', phase: 'cron-live' }, extra: { idc } },
  );
}

// #374: ciclos consecutivos que un `live` con marcador puede desaparecer del
// feed mc antes de darlo por finalizado. El feed es global y lista todos los
// activos, así que 3 ciclos (~2 min) con el feed respondiendo es señal fiable;
// conservador a propósito (cualquier fallo de la fuente desactiva este camino).
const MISSING_LIVE_CYCLES = Number(process.env['MISSING_LIVE_CYCLES'] ?? 3);
/** Un rastreador de "ausente del feed" por portal: cada feed solo ve los suyos. */
const missingLiveTrackers = new Map<string, MissingLiveTracker>();
function trackerFor(key: string): MissingLiveTracker {
  let t = missingLiveTrackers.get(key);
  if (!t) { t = new MissingLiveTracker(MISSING_LIVE_CYCLES); missingLiveTrackers.set(key, t); }
  return t;
}

const POLL_INTERVAL  = Number(process.env['POLL_INTERVAL_S']  ?? 45) * 1000;
/** Match center sidgad: separación mínima con partidos en ventana y sin ellos. */
const MC_ACTIVE_MS = Number(process.env['MC_ACTIVE_S'] ?? 60) * 1000;
const MC_IDLE_MS   = Number(process.env['MC_IDLE_S'] ?? 600) * 1000;
const lastMcAt = new Map<string, number>();
/** Última acta pedida por partido y lo que decía el feed entonces (ver fichaDue). */
const lastFicha = new Map<string, { at: number; sig: string }>();
const WINDOW_HOURS   = Number(process.env['WINDOW_HOURS']     ?? 2);
const MAX_RUNTIME_MS = Number(process.env['MAX_RUNTIME_MIN']  ?? 180) * 60 * 1000;
// Cesión al scheduler (ver live-yield.ts). 0 = no ceder.
const LIVE_YIELD_MS  = Number(process.env['LIVE_YIELD_MIN']   ?? 60) * 60 * 1000;
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
//
// El fichero se toca SIEMPRE (no depende de las fuentes). El monitor de Sentry
// sí refleja el estado (#293): si una fuente lleva varios ciclos fallando, el
// check-in va como 'error' para que el latido no diga "todo bien" en falso.
function heartbeat(): void {
  touchAlive();
  try {
    Sentry.captureCheckIn(
      { monitorSlug: CRON_MONITOR_SLUG, status: sourceFailures.hasFailing() ? 'error' : 'ok' },
      CRON_MONITOR_CONFIG,
    );
  } catch { /* nunca romper el cron por el monitor */ }
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
 * #417: anota el intento (para espaciar los siguientes) y, en directos con
 * goles, aprende si la competición publica el acta en directo o solo al final.
 */
async function recordFichaFetch(match: FichaCandidate, events: number): Promise<void> {
  await db.query(
    `UPDATE matches SET ficha_fetched_at = NOW(),
            ficha_finished_tries = ficha_finished_tries + CASE WHEN status = 'finished' THEN 1 ELSE 0 END
      WHERE id = $1`,
    [match.id],
  );
  if (match.status !== 'live') return;
  const goals = (match.home_score ?? 0) + (match.away_score ?? 0);
  // Misma regla que learnActaMode (acta-mode.ts, testeada), pero atómica en
  // SQL: varios partidos de la competición se procesan en paralelo y cada
  // partido cuenta UNA vez (acta_probe), no una por ciclo.
  if (events > 0) {
    await db.query(
      `UPDATE competitions SET acta_mode = 'live', acta_post_strikes = 0
        WHERE id = $1 AND (acta_mode IS DISTINCT FROM 'live' OR acta_post_strikes <> 0)`,
      [match.competition_id],
    );
    return;
  }
  if (goals <= 0) return;
  const r = await db.query<{ acta_mode: string | null }>(
    `WITH probe AS (
       UPDATE matches SET acta_probe = true WHERE id = $1 AND NOT acta_probe RETURNING id
     )
     UPDATE competitions
        SET acta_post_strikes = acta_post_strikes + 1,
            acta_mode = CASE WHEN acta_post_strikes + 1 >= $3 THEN 'post' ELSE acta_mode END
      WHERE id = $2 AND EXISTS (SELECT 1 FROM probe)
      RETURNING acta_mode`,
    [match.id, match.competition_id, ACTA_POST_STRIKES],
  );
  const mode = r.rows[0]?.acta_mode ?? null;
  if (mode === 'post' && match.acta_mode !== 'post') {
    log.info({ competitionId: match.competition_id }, 'Competición marcada «acta solo al final» (#417)');
  }
}

/**
 * Descarga y persiste la ficha resumen (eventos, alineaciones, faltas) de todos
 * los partidos que están live o que terminaron recientemente sin tener eventos.
 * Opera sobre TODAS las temporadas activas.
 */
async function runFichasForActiveMatches(seasonIds: string[]): Promise<EndedByActa[]> {
  const ended: EndedByActa[] = [];
  // Selección (y por qué cada caso) en ficha-candidates.ts.
  const rows = { rows: await selectFichaCandidates(seasonIds) };

  if (rows.rows.length === 0) return ended;

  log.info({ count: rows.rows.length, concurrency: FICHA_CONCURRENCY }, 'Procesando fichas para partidos activos/recientes');

  await forEachLimited(rows.rows, FICHA_CONCURRENCY, async (match) => {
    // Acta solo con novedades en el feed o cada 5 min (fichaDue): sidgad
    // bloqueó la IP el 31/10/2026 por exceso de peticiones.
    const t = Date.now();
    if (!fichaDue(match, lastFicha.get(match.id), t)) return;
    lastFicha.set(match.id, { at: t, sig: fichaSignature(match) });
    const source = sourceForMatchRef(match.source_ref);
    if (!source) {
      // #333: una omisión no debe ser invisible con LOG_LEVEL=info por defecto.
      log.warn(
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
      const res = await scraper.run();
      await recordFichaFetch(match, res.data?.length ?? 0).catch((err) =>
        log.debug({ err, matchId: match.id }, 'No se pudo registrar el intento de ficha (#417)'));
      // Señal explícita de final en el acta (periodo_fin): se aplica después,
      // con la guarda del feed en vivo (ver acta-final.ts).
      if (match.status === 'live' && scraper.liveHeader?.ended) {
        ended.push({ matchId: match.id, seasonId: match.season_id, sourceRef: match.source_ref });
      }
      log.debug({ matchId: match.id, idp, idc, source: source.key }, 'Ficha procesada');
    } catch (err) {
      log.warn({ err, matchId: match.id, idp, idc, source: source.key }, 'Error en ficha — continuando con siguiente partido');
    }
  });
  return ended;
}

/**
 * Temporadas con actividad (live o partido inminente en la ventana) de UN
 * portal sidgad. De éstas se hace snapshot→diff para el push.
 *
 * Se mira el prefijo de los PARTIDOS (`fecapa_match_…`), no el de la
 * competición: las de la RFEP sembradas en 2026/27 guardan el idc pelado en
 * `competitions.source_ref` (sin `fep_`), y con el filtro antiguo
 * (`c.source_ref LIKE 'fep_%'`) se quedaban fuera del snapshot.
 */
async function activeSeasonsFor(seasonIds: string[], source: SourceDef): Promise<string[]> {
  const res = await db.query<{ season_id: string }>(
    `SELECT DISTINCT m.season_id FROM matches m
     WHERE m.season_id = ANY($1)
       AND m.source_ref LIKE $3
       AND ( m.status = 'live'
          OR (m.status = 'scheduled'
              AND m.scheduled_at BETWEEN NOW() - INTERVAL '3 hours'
                                     AND NOW() + make_interval(hours => $2::int)) )`,
    [seasonIds, WINDOW_HOURS, `${matchRef(source, '').replace(/_/g, '\\_')}%`]
  );
  return res.rows.map((r) => r.season_id);
}

/**
 * #374: finaliza los `live` FEP con marcador que el feed mc lleva N ciclos sin
 * listar. Conserva el último marcador (no lo inventa) y rellena `started_at` si
 * faltaba. Solo se llama con el feed sano y con datos: una caída de la fuente
 * NO es un final.
 */
async function finalizeMissingLive(source: SourceDef, seasonIds: string[], feed: ScrapedMatch[]): Promise<void> {
  const seen = new Set(feed.map((m) => m.sourceRef).filter((r): r is string => !!r));

  const liveRes = await db.query<{ source_ref: string }>(
    `SELECT source_ref FROM matches
      WHERE season_id = ANY($1)
        AND status = 'live'
        AND source_ref LIKE $2
        AND home_score IS NOT NULL
        AND away_score IS NOT NULL`,
    // Solo los partidos del portal del feed (A1): el feed de un portal no
    // puede cerrar partidos de otro.
    [seasonIds, `${matchRef(source, '').replace(/_/g, '\\_')}%`]
  );

  const refs = trackerFor(source.key).observe(liveRes.rows.map((r) => r.source_ref), seen);
  if (refs.length === 0) return;

  const upd = await db.query(
    `UPDATE matches
        SET status      = 'finished',
            finished_at = COALESCE(finished_at, NOW()),
            started_at  = COALESCE(started_at, scheduled_at),
            updated_at  = NOW()
      WHERE source_ref = ANY($1) AND status = 'live'`,
    [refs]
  );
  const count = upd.rowCount ?? 0;
  if (count === 0) return;

  log.warn(
    { count, refs, cycles: MISSING_LIVE_CYCLES },
    'Partidos live ausentes del feed mc N ciclos → finalizados con el último marcador'
  );
  Sentry.captureMessage(
    `${count} partido(s) ${source.key} finalizados por desaparición del feed mc (${MISSING_LIVE_CYCLES} ciclos)`,
    { level: 'warning', extra: { refs, portal: source.key } }
  );
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
async function runFepScores(seasonIds: string[], playingNow: Set<string>): Promise<number> {
  // Un match center por portal sidgad (RFEP, FECAPA, autonómicas, FISR…).
  // World Skate va aparte (runWorldskateScores). La RFEP se pide siempre, como
  // hasta ahora; el resto SOLO si tiene partidos en ventana (sin actividad no
  // hay ni una petición). Aislado por portal: si uno cae, los demás siguen.
  let upserted = 0;
  const now = Date.now();
  for (const source of SOURCES) {
    if (source.key === 'wse') continue;
    try {
      const active = await activeSeasonsFor(seasonIds, source);
      if (source.key !== 'fep' && active.length === 0) continue;
      // Ritmo (sidgad bloqueó la IP el 31/10/2026): con partidos en ventana,
      // como mucho cada MC_ACTIVE_MS; sin ellos (solo la RFEP, que se pide para
      // descubrir partidos que el calendario aún no tiene), cada MC_IDLE_MS.
      const gap = active.length > 0 ? MC_ACTIVE_MS : MC_IDLE_MS;
      if (now - (lastMcAt.get(source.key) ?? 0) < gap) continue;
      lastMcAt.set(source.key, now);
      upserted += await runPortalScores(source, active, seasonIds, playingNow);
    } catch (err) {
      log.warn({ err, portal: source.key }, 'marcadores del portal fallaron — sigue con el siguiente');
    }
  }
  return upserted;
}

async function runPortalScores(
  source: SourceDef,
  activeSeasons: string[],
  seasonIds: string[],
  playingNow: Set<string>,
): Promise<number> {
  const portal = source.client.portalPrefix;

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
  const scraper  = new FepMatchesScraper({ seasonId: seasonFallback, source });
  const pipeline = new EtlPipeline({ sportSlug: SPORT_SLUG, seasonId: seasonFallback, requireTeamsInSeason: true, stampLiveTimes: true });

  const result = await scraper.run();
  if (result.data.length === 0) {
    // rfep_mc_1.php normalmente devuelve decenas de partidos. 0 = la fuente cayó,
    // cambió de estructura o nos bloqueó. Pero un fallo de red AISLADO (sidgad ya
    // reintenta 3×) se recupera al ciclo siguiente (45s): no es una incidencia.
    // Solo escalamos a Sentry como ERROR si FALLA VARIOS CICLOS SEGUIDOS; uno
    // suelto queda como warning/breadcrumb para no generar ruido.
    if (!result.success) {
      const fails = (consecutiveMcFailures.get(source.key) ?? 0) + 1;
      consecutiveMcFailures.set(source.key, fails);
      if (fails >= MC_FAIL_ALERT_THRESHOLD) {
        Sentry.captureException(
          new Error(`Match center ${portal}_mc_1.php falló ${fails} ciclos seguidos`),
          { tags: { phase: 'mc-scrape', portal }, extra: { errors: result.errors } });
      } else {
        log.warn({ errors: result.errors, consecutiveMcFailures: fails, portal },
          'Scraper de marcadores falló (transitorio) — reintento en el próximo ciclo');
      }
    } else if (activeSeasons.length > 0) {
      // 200 OK pero 0 partidos habiendo FEP con actividad esperada: sospechoso.
      // (Fuera de temporada FEP el feed devuelve 0 legítimamente y no alertamos.)
      Sentry.captureMessage(`${portal}_mc_1.php devolvió 0 partidos habiendo partidos en juego — posible cambio/caída de la fuente`, {
        level: 'warning', fingerprint: ['mc-empty', portal], tags: { portal },
      });
    } else {
      log.debug({ portal }, 'match center sin partidos y sin actividad esperada — normal fuera de temporada');
    }
    return 0;
  }
  // Ciclo con datos: la fuente responde, reseteamos el contador de fallos.
  consecutiveMcFailures.set(source.key, 0);
  for (const m of result.data) if (m.status === 'live' && m.sourceRef) playingNow.add(m.sourceRef);

  const etl = await pipeline.runMatches(result);

  // #374: antes del push, para que la transición live→finished dispare el aviso
  // de final (prev snapshot era live, el actual ya finished).
  try { await finalizeMissingLive(source, seasonIds, result.data); }
  catch (err) { log.warn({ err }, 'finalizado por feed ausente falló — el ciclo sigue'); }

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
async function runWorldskateScores(playingNow: Set<string>): Promise<void> {
  const { active, dormant } = await resolveWorldskate();
  await reportDormantWorldskate(dormant);

  for (const ctx of active) {
    const prev       = pushEnabled ? await snapshotMatches(ctx.seasonId) : new Map();
    const prevRounds = pushEnabled ? await snapshotRounds(ctx.seasonId)  : new Map();
    let ok = false;
    try {
      const r = await runWorldskate(ctx, (seasonId) =>
        new EtlPipeline({ sportSlug: SPORT_SLUG, seasonId, createRounds: true, stampLiveTimes: true }));
      ok = r.ok;
      for (const ref of r.liveRefs) playingNow.add(ref);
    } catch (err) {
      log.warn({ err, competition: ctx.name }, 'marcadores World Skate fallaron — sigue');
      noteWorldskateResult(ctx.name, ctx.idc, false);
      continue;
    }
    // #293: alimenta el latido y el contador por fuente. Un éxito resetea la racha.
    noteWorldskateResult(ctx.name, ctx.idc, ok);
    try { await diffAndNotify(prev, prevRounds, ctx.seasonId); } catch (err) {
      log.warn({ err, competition: ctx.name }, 'push (World Skate) fallo — sigue');
    }
  }
}

/**
 * Portugal (FPP): estado y marcador desde /Direto (un GET por ciclo, y ninguno
 * si no hay partidos FPP en ventana). Snapshot→diff por temporada para que
 * salgan los avisos de inicio y final. Devuelve las fichas a cargar después,
 * dentro de la ventana de snapshot de goles/tarjetas del ciclo.
 */
async function runFppScores(playingNow: Set<string>): Promise<FppFichaTarget[]> {
  const seasons = [...new Set((await fppLiveCandidates()).map((c) => c.season_id))];
  if (seasons.length === 0) return [];
  const prev = new Map<string, { m: Awaited<ReturnType<typeof snapshotMatches>>; r: Awaited<ReturnType<typeof snapshotRounds>> }>();
  if (pushEnabled) for (const sid of seasons) prev.set(sid, { m: await snapshotMatches(sid), r: await snapshotRounds(sid) });
  const cycle = await runFppLiveScores();
  for (const ref of cycle.liveRefs) playingNow.add(ref);
  for (const [sid, p] of prev) {
    try { await diffAndNotify(p.m, p.r, sid); } catch (err) {
      log.warn({ err, seasonId: sid }, 'push (FPP) fallo — sigue');
    }
  }
  return cycle.fichas;
}

/**
 * Euskadi + Liga Norte (FVP): una sola llamada a /public/partidos/marcadores
 * (ninguna si no hay partidos FVP en ventana). Como FPP: snapshot→diff por
 * temporada para inicio/final, y las actas se cargan después, en la ventana
 * de snapshot de goles y tarjetas.
 */
async function runFvpScores(playingNow: Set<string>): Promise<FvpFichaTarget[]> {
  const seasons = [...new Set((await fvpLiveCandidates()).map((c) => c.season_id))];
  if (seasons.length === 0) return [];
  const prev = new Map<string, { m: Awaited<ReturnType<typeof snapshotMatches>>; r: Awaited<ReturnType<typeof snapshotRounds>> }>();
  if (pushEnabled) for (const sid of seasons) prev.set(sid, { m: await snapshotMatches(sid), r: await snapshotRounds(sid) });
  const cycle = await runFvpLiveScores();
  for (const ref of cycle.liveRefs) playingNow.add(ref);
  for (const [sid, p] of prev) {
    try { await diffAndNotify(p.m, p.r, sid); } catch (err) {
      log.warn({ err, seasonId: sid }, 'push (FVP) fallo — sigue');
    }
  }
  return cycle.fichas;
}

/**
 * live → finished por la señal explícita del acta (periodo_fin), salvo que un
 * feed en vivo lo siga dando en juego en este mismo ciclo. Snapshot→diff por
 * temporada para que el push de final salga igual que con el feed.
 */
async function finalizeEndedByActa(ended: EndedByActa[], playingNow: ReadonlySet<string>): Promise<void> {
  const candidates = actaFinalCandidates(ended, playingNow);
  if (candidates.length === 0) return;
  const seasons = [...new Set(candidates.map((c) => c.seasonId))];
  const prev = new Map<string, { matches: Awaited<ReturnType<typeof snapshotMatches>>; rounds: Awaited<ReturnType<typeof snapshotRounds>> }>();
  if (pushEnabled) {
    for (const sid of seasons) prev.set(sid, { matches: await snapshotMatches(sid), rounds: await snapshotRounds(sid) });
  }
  const done = await finalizeByActa(candidates);
  if (done.length === 0) return;
  log.info({ count: done.length, refs: done.map((d) => d.sourceRef) }, 'Partidos finalizados por el acta (señal explícita de la fuente)');
  if (!pushEnabled) return;
  for (const sid of new Set(done.map((d) => d.seasonId))) {
    const p = prev.get(sid);
    if (!p) continue;
    try { await diffAndNotify(p.matches, p.rounds, sid); } catch (err) {
      log.warn({ err, seasonId: sid }, 'push de final (acta) fallo — el ciclo sigue');
    }
  }
}

/**
 * Un ciclo completo: marcadores de TODAS las fuentes (FEP + World Skate + FPP + FVP) y,
 * después, actas y notificaciones. Cada fuente tiene su propio scraper y va
 * aislada: que una caiga no impide que las demás se actualicen.
 */
async function runOneCycle(seasonIds: string[]): Promise<number> {
  let upserted = 0;
  // Partidos que los feeds en vivo dan EN JUEGO en este ciclo (guarda del final por acta).
  const playingNow = new Set<string>();
  try {
    upserted = await runFepScores(seasonIds, playingNow);
  } catch (err) {
    // Que la FEP falle no debe impedir que se refresquen las actas del resto.
    log.warn({ err }, 'marcadores FEP fallaron — el ciclo sigue con las fichas');
  }

  try {
    await runWorldskateScores(playingNow);
  } catch (err) {
    log.warn({ err }, 'marcadores World Skate fallaron — el ciclo sigue');
  }

  let fppFichas: FppFichaTarget[] = [];
  try {
    fppFichas = await runFppScores(playingNow);
  } catch (err) {
    log.warn({ err }, 'marcadores FPP fallaron — el ciclo sigue');
  }

  let fvpFichas: FvpFichaTarget[] = [];
  try {
    fvpFichas = await runFvpScores(playingNow);
  } catch (err) {
    log.warn({ err }, 'marcadores FVP fallaron — el ciclo sigue');
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
  let endedByActa: EndedByActa[] = [];
  try {
    endedByActa = await runFichasForActiveMatches(seasonIds);
  } catch (err) {
    log.warn({ err }, 'runFichasForActiveMatches fallo — ciclo de scores sigue OK');
  }
  // Timeline FPP de los partidos en juego/recién terminados: va aquí, entre el
  // snapshot y el diff, para que sus goles y tarjetas generen los avisos.
  for (const t of fppFichas) {
    try { await processFppFicha(t); } catch (err) {
      log.warn({ err, match: t.sourceRef }, 'ficha FPP en directo fallo — sigue');
    }
  }
  for (const t of fvpFichas) {
    try { await processFvpFicha(t); } catch (err) {
      log.warn({ err, match: t.sourceRef }, 'acta FVP en directo fallo — sigue');
    }
  }
  // Final EXPLÍCITO por acta (con snapshot→diff para que salga el aviso de final).
  try { await finalizeEndedByActa(endedByActa, playingNow); } catch (err) {
    log.warn({ err }, 'final por acta falló — lo recogerá el feed/el vigilante');
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
  // LOCK GLOBAL de ingesta (#317): mismo advisory lock que run-pipeline.
  // El flock de /tmp no excluye entre contenedores: sin esto, un cron-live
  // duplicado (o un run manual) escribía el mismo feed 2-4 veces a la vez.
  // Si otro proceso lo sostiene, se sale en limpio (el scheduler lo absorbe).
  const lock = await acquireEtlLock();
  if (!lock) {
    log.warn('Otro proceso de ingesta tiene el lock global (#317) — salgo sin ejecutar');
    await closeDb();
    return;
  }

  try {
    if ((await mainInner()) === 'yield') process.exitCode = LIVE_YIELD_EXIT_CODE;
  } finally {
    await lock.release();
  }
}

async function mainInner(): Promise<'done' | 'yield'> {
  heartbeat(); // latido al monitor: "el cron arrancó"

  // ── Resumen matinal (#383) ────────────────────────────────────────────────
  // Se intenta en CADA invocación, no solo cuando hay actividad: el cron sale
  // antes de cualquier ciclo si no hay partidos (más abajo), así que engancharlo
  // solo al dispatcher dejaba sin resumen los días tranquilos. La propia función
  // decide si toca (solo 08:00–12:00) y el ledger persistente (`push_summary_log`)
  // evita duplicados entre invocaciones/reinicios. Nunca debe romper el cron.
  try { await deliverMorningSummaries(); }
  catch (err) { log.warn({ err }, 'resumen matinal fallo — el cron sigue'); }

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
      return 'done';
    }
    log.info(
      { windowHours: WINDOW_HOURS, seasonIds },
      'Sin partidos live ni proximos — saliendo sin trabajo.'
    );
    return 'done';
  }

  // ── 2. Modo activo: bucle de polling ───────────────────────────────────────
  const startedAt = Date.now();
  log.info(
    { hasLive: initial.hasLive, hasUpcoming: initial.hasUpcoming, pollIntervalS: POLL_INTERVAL / 1000 },
    'Actividad detectada — iniciando polling'
  );

  let cycle = 0;
  let yielded = false;

  while (true) {
    cycle++;
    heartbeat(); // latido en cada ciclo: mantiene el monitor vivo en partidos largos
    const elapsed = Date.now() - startedAt;

    const decision = loopDecision(elapsed, LIVE_YIELD_MS, MAX_RUNTIME_MS);
    if (decision === 'stop') {
      log.warn({ elapsedMin: Math.round(elapsed / 60_000) }, 'Tiempo maximo alcanzado — saliendo.');
      break;
    }
    if (decision === 'yield') {
      // Partidos aún en ventana: se suelta el lock para la pasada horaria y el
      // scheduler vuelve a lanzar el directo enseguida (sin la pausa de 5 min).
      log.info({ cycle, elapsedMin: Math.round(elapsed / 60_000) }, 'Cesión al scheduler — el directo vuelve en cuanto acabe la pasada horaria');
      yielded = true;
      break;
    }

    const cycleStart = Date.now();
    try {
      const upserted = await runOneCycle(seasonIds);
      log.info(
        { cycle, upserted, durationMs: Date.now() - cycleStart },
        'Ciclo completado'
      );
      // Resumen de salida SIDGAD cada ~15 min de directo (20 ciclos de 45 s):
      // éxitos/fallos/reintentos/latencia por ruta y portal. En debug, cada ciclo.
      logEgressSummary(log, 'debug');
      if (cycle % 20 === 0) logEgressSummary(log, 'info');
    } catch (err) {
      log.error({ cycle, err }, 'Error en ciclo — reintentando en siguiente tick');
      Sentry.captureException(err, { tags: { phase: 'cron-cycle' }, extra: { cycle } });
    }

    const status = await checkWindow(seasonIds, WINDOW_HOURS);

    if (!status.hasLive && !status.hasUpcoming) {
      log.info({ cycle }, 'Todos los partidos finalizados — ciclo final de fichas y saliendo.');
      try {
        const ended = await runFichasForActiveMatches(seasonIds);
        await finalizeEndedByActa(ended, new Set());
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

  log.info({ totalCycles: cycle, totalMin: Math.round((Date.now() - startedAt) / 60_000), yielded }, 'Orquestador terminado');
  return yielded ? 'yield' : 'done';
}

main()
  .catch((err) => { log.error({ err }, 'Error fatal'); Sentry.captureException(err); process.exitCode = 1; })
  // flush ANTES de salir: el cron es un proceso corto y si no se pierden los eventos
  .finally(async () => {
    logEgressSummary(log, 'info');
    await flushPushAnalytics();
    await Sentry.flush(2000);
    await closeDb();
  });

/**
 * Runner end-to-end: scraper → ETL en un solo proceso.
 * Conecta la salida del scraper con el pipeline ETL sin archivos intermedios.
 *
 * Uso:
 *   npx ts-node --esm apps/etl/src/run-pipeline.ts --entity=calendar  --season-id=<uuid>
 *   npx ts-node --esm apps/etl/src/run-pipeline.ts --entity=standings --season-id=<uuid>
 *   npx ts-node --esm apps/etl/src/run-pipeline.ts --entity=matches   --season-id=<uuid>
 *   npx ts-node --esm apps/etl/src/run-pipeline.ts --entity=all       --season-id=<uuid>
 *
 * Por defecto scrapea la OK Liga regular (idc=3150). Para otra competición
 * (p. ej. el playoff, idc=3481) pasa --idc:
 *   npx tsx --env-file=.env apps/etl/src/run-pipeline.ts --entity=calendar --idc=3481 --season-id=<PLAYOFF_SEASON_ID>
 *
 * Con COMPETITION_SOURCES_DRIVEN=1 y sin --season-id/--idc, calendar, standings
 * y fichas-pendientes iteran TODAS las competiciones FEP activas (Fases 2 y 3).
 *
 * También acepta --dry-run para validar transformaciones sin persistir.
 */
import './instrument.js'; // Sentry.init — el PRIMERO de todo
import * as Sentry from '@sentry/node';
import { createLogger } from '@sports/logger';
import { db, closeDb, getActiveScrapePlan, insertScrapeLog, startScrapeRun, finishScrapeRun } from '@sports/db';
import { EtlPipeline } from './pipeline.js';
import { forEachLimited } from './concurrency.js';
import { downloadTeamLogos } from './team-logos.js';
import { scrapeRunStatus } from './scrape-log-status.js';
import { acquireEtlLock } from './etl-lock.js';
import { planSourceStructure, type PhaseKind, type StructureRow, type ScrapedMatch } from '@sports/shared-types';
import { reconcileSyntheticMatches, fillVenueCity } from '@sports/db';
import { applyStructurePlan, assignStructure, declaredKindFromFormat, pruneAfterLoad, type AppliedStructure } from './structure/apply-structure.js';

// Los scrapers viven en apps/scraper — importamos via ruta relativa (ts-node lo resuelve)
import { FepCalendarScraper } from '../../scraper/src/scrapers/fep/fep-calendar.scraper.js';
import { FepStandingsScraper } from '../../scraper/src/scrapers/fep/fep-standings.scraper.js';
import { FepMatchesScraper } from '../../scraper/src/scrapers/fep/fep-matches.scraper.js';
import { FepFichaScraper } from '../../scraper/src/scrapers/fep/fep-ficha.scraper.js';
import { resolveWorldskate } from '../../scraper/src/scrapers/worldskate/run-worldskate.js';
import { resolveMatchSourceIds, matchRefLikePatterns, sourceForCompetitionRef, type SourceDef } from '../../scraper/src/core/sources.js';
import { logEgressSummary } from '../../scraper/src/egress/index.js';

const log = createLogger({ service: 'run-pipeline' });

const IDC_OK_LIGA = '3150';
const SPORT_SLUG = 'hockey-patines';

// Nombres conocidos por idc (solo para logging)
const IDC_NAMES: Record<string, string> = {
  '3150': 'OK LIGA MASCULINA',
  '3481': 'PLAY OFFS OK LIGA',
};
// SOLO para el modo manual `--idc` (sin competition_sources) y para la
// clasificación. La ESTRUCTURA del calendario (fases/rondas) ya no depende de
// estas listas: la decide la fuente (ver processCalendar / planSourceStructure).
//   · Playoff de las ligas de oro: no tienen clasificación propia (hide_clasif).
const PLAYOFF_IDCS_PIPELINE = ['3481', '3484'];
//   · Copas/supercopas: su clasificación vacía es lo esperado (#329), y en modo
//     manual cuentan como metadato "eliminatoria" si la fuente no lo deja claro.
const CUP_IDCS = new Set(['3258', '3259', '3177', '3178', '3301', '3302']);
const LEGACY_PLAYOFF_IDCS = new Set(PLAYOFF_IDCS_PIPELINE);

// ── Punto 10, Fase 2: scrape guiado por `competition_sources` ────────────────
// Con el flag ACTIVO, un `run-pipeline --entity=calendar|standings` SIN
// --season-id/--idc explícitos deja de mirar sólo la OK Liga (SEASON_ID/IDC del
// entorno) y itera TODAS las competiciones FEP activas de la tabla, resolviendo
// la temporada vigente (seasons.is_current) y los idc de cada una. Apagado (por
// defecto) el comportamiento es idéntico al de antes. Palanca de emergencia:
// bajar is_active de una competición (dato) o apagar el flag.
const FEP_SCRAPER_KEY = 'fep_hockey';
const COMPETITION_SOURCES_DRIVEN =
  process.env['COMPETITION_SOURCES_DRIVEN'] === '1' ||
  process.env['COMPETITION_SOURCES_DRIVEN'] === 'true';
// Competiciones en paralelo en el modo multi. Un tope moderado escala el scrape
// a decenas de ligas sin martillear sidgad (secuencial + pausa se quedaba corto).
const SCRAPE_CONCURRENCY = Number(process.env['SCRAPE_CONCURRENCY'] ?? 4);


/**
 * Scrapea el calendario de una competición (uno o varios idc: liga regular +
 * su playoff) hacia una temporada concreta y le aplica la ESTRUCTURA que publica
 * la fuente: fases (bloques `content_fase_X` y su título) y rondas (cabeceras
 * "JORNADA 5", "2 CUARTOS", "SEMIFINALES"…). Mismo camino para cualquier
 * formato — liga, liga+playoff, grupos, final four, eliminatoria — sin listas de
 * idc ni casos especiales (ver `planSourceStructure`).
 *
 * `declaredKind` es el metadato de `competition_sources` (nivel 2): solo decide
 * cuando la fuente no deja claro el tipo de una fase.
 */
async function processCalendar(
  seasonId: string,
  idcs: string[],
  pipeline: EtlPipeline,
  timezone?: string,
  declaredKind: PhaseKind | null = null,
  dryRun = false,
  source?: SourceDef,
): Promise<void> {
  // 1. Scrape de TODOS los idc de la competición: la estructura se planifica
  //    sobre el conjunto para ordenar sus fases (liga antes que playoff).
  const scraped: Array<{ idc: string; result: Awaited<ReturnType<FepCalendarScraper['run']>>; rows: FepCalendarScraper['calendarRows'] }> = [];
  for (const calIdc of idcs) {
    const calName = IDC_NAMES[calIdc] ?? `idc ${calIdc}`;
    log.info({ idc: calIdc, competitionName: calName }, '→ Scrapeando calendario...');
    const scraper = new FepCalendarScraper({ idc: calIdc, seasonId, competitionName: calName, timezone, ...(source ? { source } : {}) });
    const result = await scraper.run();
    log.info({ idc: calIdc, found: result.data.length, errors: result.errors.length }, 'Calendario scrapeado');

    // Rastro del run cuando el loader NO llega a escribir (#329). Un calendario
    // vacío SIEMPRE es sospechoso (la fuente cambió o cayó), así que se
    // registra success+0 y el vigilante diario dispara la alerta 'zero'.
    const status = scrapeRunStatus(result.success, result.data.length, false);
    if (!dryRun && (status !== 'success' || result.data.length === 0)) {
      await registrarRunSinLoader(result, status, 'match', calIdc);
    }
    scraped.push({ idc: calIdc, result, rows: scraper.calendarRows });
  }

  // 2. Estructura explícita de la fuente → fases + rondas (+ nº de partido de serie).
  const rows: Array<{ structure: StructureRow; match: ScrapedMatch | null }> = [];
  for (const s of scraped) {
    for (const r of s.rows) rows.push({ structure: { ...r.structure, docIndex: rows.length }, match: r.match });
  }
  let applied: AppliedStructure | null = null;
  if (rows.length > 0) {
    const plan = planSourceStructure(rows.map((r) => r.structure), { declaredKind });
    if (dryRun) {
      log.info({ phases: plan.phases.map((p) => ({ ref: p.ref, kind: p.kind, placement: p.isPlacement, by: p.resolvedBy, rounds: p.rounds.length })) },
        '[dry-run] Estructura planificada (no se escribe)');
    } else {
      const sourceId = rows.find((r) => r.match)?.match?.sourceId ?? null;
      applied = await applyStructurePlan(seasonId, plan, sourceId);
      assignStructure(rows, plan, applied);
    }
  }

  // 3. Carga de partidos, idc a idc.
  for (const s of scraped) {
    if (s.result.data.length > 0) {
      const etl = await pipeline.runMatches(s.result);
      log.info({ idc: s.idc, ...etl }, '✅ Partidos cargados');
    }
  }

  // 4. Solo con TODOS los idc leídos bien: la estructura recibida es completa.
  if (applied && scraped.every((s) => s.result.success)) await pruneAfterLoad(seasonId, applied);
}

/** Formato declarado de la competición de una temporada (modo manual `--idc`). */
async function declaredFormatOfSeason(seasonId: string): Promise<string | null> {
  const { rows } = await db.query<{ format: string | null }>(
    `SELECT cs.external_ids->>'format' AS format
       FROM seasons s JOIN competition_sources cs ON cs.competition_id = s.competition_id
      WHERE s.id = $1 LIMIT 1`,
    [seasonId],
  );
  return rows[0]?.format ?? null;
}

/**
 * Scrapea la clasificación de una competición. El playoff (3481) no tiene
 * clasificación (hide_clasif:1 en sidgad); las copas/eliminatorias devuelven
 * vacío (esperado: `expectedEmptyIdcs`) y no se registran como éxito-vacío
 * para que el vigilante no alerte en falso (#329).
 */
async function processStandings(
  idc: string,
  competitionName: string,
  pipeline: EtlPipeline,
  playoffIdcs: ReadonlySet<string> = LEGACY_PLAYOFF_IDCS,
  expectedEmptyIdcs: ReadonlySet<string> = new Set(),
  dryRun = false,
  source?: SourceDef,
): Promise<void> {
  if (playoffIdcs.has(idc)) {
    log.info('→ Playoff sin clasificación (eliminatorias) — skip standings');
    return;
  }
  log.info({ idc, competitionName }, '→ Scrapeando clasificación...');
  const scraper = new FepStandingsScraper({ idc, competitionName, ...(source ? { source } : {}) });
  const result = await scraper.run();
  log.info({ found: result.data.length, errors: result.errors.length }, 'Clasificación scrapeada');

  // Rastro del run cuando el loader NO llega a escribir (#329): fallo del
  // scrape o éxito con 0 filas (el "éxito silencioso" que el vigilante debe
  // ver; las copas van como 'skipped' porque es su estado normal).
  const status = scrapeRunStatus(result.success, result.data.length, expectedEmptyIdcs.has(idc));
  if (!dryRun && (status !== 'success' || result.data.length === 0)) {
    await registrarRunSinLoader(result, status, 'standing', idc);
  }

  if (result.data.length > 0) {
    const etl = await pipeline.runStandings(result);
    log.info(etl, '✅ Clasificación cargada');
  }
}

/**
 * Registra en scrape_logs un run cuyo loader no llegó a ejecutarse (#329) y,
 * si fue un fallo, lo manda a Sentry (mismo patrón que run-worldskate, #294).
 * Best-effort: el registro nunca debe romper el pipeline.
 */
async function registrarRunSinLoader(
  result: { scraperKey: string; durationMs: number; data: unknown[]; errors: Array<{ message: string }> },
  status: 'error' | 'skipped' | 'success',
  entityType: 'match' | 'standing',
  idc: string,
): Promise<void> {
  const errorMessage = status === 'error'
    ? (result.errors.map((e) => e.message).filter(Boolean).join(' | ') || 'scrape sin detalle').slice(0, 500)
    : undefined;
  try {
    await insertScrapeLog({
      scraperKey: result.scraperKey,
      entityType,
      status,
      recordsFound: result.data.length,
      errorMessage,
      durationMs: result.durationMs,
    });
  } catch (err) {
    log.warn({ err }, 'No se pudo registrar el run en scrape_logs');
  }
  if (status === 'error') {
    log.error({ idc, entityType, errors: result.errors }, 'Scrape falló — registrado en scrape_logs y alertado');
    // 'warning' y no 'error': un ciclo fallido aislado no debe abrir incidente;
    // el fallo PERSISTENTE lo escala scrape-health-watch (status='error' del
    // último run) y los trackers de ciclos consecutivos del directo.
    Sentry.captureMessage(
      `Scrape FEP falló (${entityType}, idc ${idc}): ${errorMessage}`,
      { level: 'warning', tags: { source: 'fep' }, extra: { idc, entityType, errors: result.errors } },
    );
  }
}

/**
 * Modo multi (punto 10, Fase 2): itera las competiciones FEP activas de
 * `competition_sources`, resuelve la temporada vigente de cada una y scrapea la
 * entidad pedida. Un fallo en una competición se registra y no aborta el resto.
 */
async function runMultiCompetition(
  entity: 'calendar' | 'standings',
  dryRun: boolean,
): Promise<void> {
  const plan = await getActiveScrapePlan(FEP_SCRAPER_KEY);
  log.info({ count: plan.length, entity, concurrency: SCRAPE_CONCURRENCY }, '🗂️  Modo multi-competición (competition_sources)');

  let done = 0;
  let skipped = 0;
  // En paralelo con tope (forEachLimited): a decenas de ligas, el bucle
  // secuencial con pausa de cortesía tardaba de más. Cada competición va
  // aislada — un fallo se registra y no aborta al resto.
  await forEachLimited(plan, SCRAPE_CONCURRENCY, async (item) => {
    if (!item.seasonId) {
      log.warn({ competition: item.competitionName }, 'Sin temporada is_current — se omite');
      skipped++;
      return;
    }
    // Portal sidgad de ESTA competición (RFEP, FECAPA…), no el del entorno.
    const source = sourceForCompetitionRef(item.competitionSourceRef);
    if (!source) {
      log.error({ competition: item.competitionName, ref: item.competitionSourceRef },
        'Portal sidgad desconocido para la competición — se omite (añádelo en core/sources.ts)');
      skipped++;
      return;
    }
    const pipeline = new EtlPipeline({ sportSlug: SPORT_SLUG, seasonId: item.seasonId, dryRun });
    try {
      const playoff = new Set(item.playoffIdcs);
      // `format: 'bracket' | 'final_four'` en competition_sources marca las
      // copas/supercopas (#166): su propio idc primario es el que crea las
      // rondas de eliminatoria, sin la lista CUP_IDCS hardcodeada.
      const isKnockout = item.format === 'bracket' || item.format === 'final_four';
      const cups = isKnockout ? new Set([item.primaryIdc]) : new Set<string>();
      if (entity === 'calendar') {
        await processCalendar(item.seasonId, [item.primaryIdc, ...item.playoffIdcs], pipeline, item.timezone,
          declaredKindFromFormat(item.format), dryRun, source);
      } else {
        await processStandings(item.primaryIdc, item.competitionName, pipeline, playoff, cups, dryRun, source);
      }
      done++;
    } catch (err) {
      log.error({ competition: item.competitionName, idc: item.primaryIdc, err }, 'Competición falló — continúo con la siguiente');
      Sentry.captureException(err);
    }
  });

  // Reconciliación una sola vez tras recorrer el calendario de todas.
  if (entity === 'calendar') {
    const reconciled = await reconcileSyntheticMatches();
    if (reconciled > 0) log.info({ reconciled }, '🧹 Placeholders sintéticos reconciliados');
    if (!dryRun) await fillVenueCitySafe();
  }

  log.info({ done, skipped, total: plan.length, concurrency: SCRAPE_CONCURRENCY }, '🏁 Multi-competición completado');
}

function parseArgs() {
  const args: Record<string, string> = {};
  for (const arg of process.argv.slice(2)) {
    const [k, v] = arg.replace(/^--/, '').split('=');
    if (k) args[k] = v ?? 'true';
  }
  return args;
}

async function main() {
  // LOCK GLOBAL de ingesta (#317): el flock de /tmp solo excluye dentro de un
  // contenedor. Este advisory lock de Postgres excluye TAMBIÉN otros
  // contenedores y ejecuciones manuales — los 2-4 escritores concurrentes del
  // mismo feed eran la causa raíz de los deadlocks de standings (#316). Sin
  // lock disponible, se sale en limpio (el scheduler lo absorbe como "saltado").
  const lock = await acquireEtlLock();
  if (!lock) {
    log.warn('Otro proceso de ingesta tiene el lock global (#317) — salgo sin ejecutar');
    await closeDb();
    return;
  }

  try {
    await mainInner();
  } finally {
    await lock.release();
  }
}

async function mainInner() {
  const args = parseArgs();
  const entity = args['entity'] ?? 'all';
  const seasonId = args['season-id'] ?? process.env['SEASON_ID'];
  const dryRun = args['dry-run'] === 'true' || process.env['ETL_DRY_RUN'] === 'true';
  // Lote de importación (A4): si import-history lo pasa, las filas nuevas del
  // calendario se etiquetan con él para validarlas/promoverlas por lote.
  const importBatchId = args['batch-id'] ?? undefined;
  // Enrich (A5): recuperación de histórico. El upsert reasigna season_id y
  // etiqueta en el ON CONFLICT en vez de dejar el partido en 'Histórico'.
  const enrich = args['enrich'] === 'true';
  // Acepta varios idc separados por coma (liga regular + playoff de la
  // misma temporada): --idc=3150,3481
  const idcs = (args['idc'] ?? process.env['IDC'] ?? IDC_OK_LIGA).split(',').map((s) => s.trim()).filter(Boolean);
  const idc = idcs[0]!; // compat: entidades de un solo idc (ficha)
  const competitionName = IDC_NAMES[idc] ?? `idc ${idc}`;

  // ── Modo multi (punto 10, Fases 2 y 3) ───────────────────────
  // Con el flag activo y sin --season-id/--idc explícitos, el pipeline itera
  // TODAS las competiciones FEP activas de `competition_sources` en vez de leer
  // SEASON_ID/IDC del entorno. Cubre calendar y standings (Fase 2) y el barrido
  // de respaldo de fichas-pendientes (Fase 3). Los usos manuales que pasan
  // --season-id o --idc mantienen el modo single.
  const wantsMulti =
    COMPETITION_SOURCES_DRIVEN &&
    (entity === 'calendar' || entity === 'standings' || entity === 'fichas-pendientes') &&
    !args['season-id'] &&
    !args['idc'];

  if (wantsMulti && (entity === 'calendar' || entity === 'standings')) {
    log.info({ entity, dryRun }, '🚀 Iniciando pipeline (multi-competición)');
    await runMultiCompetition(entity, dryRun);
    if (entity === 'calendar' && !dryRun) await fillVenueCitySafe();
    log.info('🏁 Pipeline completado');
    return;
  }

  // El guard de SEASON_ID no aplica en modo multi (las temporadas salen del plan).
  if (!seasonId && !wantsMulti && entity !== 'download-logos' && entity !== 'ficha') {
    console.error('\n❌ SEASON_ID requerido.');
    console.error('   Obtén el UUID ejecutando primero:');
    console.error('   npx ts-node --esm apps/etl/src/seed-ok-liga.ts\n');
    process.exit(1);
  }

  log.info({ entity, seasonId, idc, dryRun }, '🚀 Iniciando pipeline');

  const pipeline = new EtlPipeline({ sportSlug: SPORT_SLUG, seasonId, dryRun, importBatchId, enrich });

  // ── Calendario ─────────────────────────────────────
  if (entity === 'calendar' || entity === 'all') {
    // Metadato declarado de la competición (si lo hay) o, en su defecto, la
    // lista legada de copas para ejecuciones manuales de esos idc.
    const declared = declaredKindFromFormat(await declaredFormatOfSeason(seasonId!))
      ?? (idcs.some((i) => CUP_IDCS.has(i)) ? 'knockout' : null);
    await processCalendar(seasonId!, idcs, pipeline, undefined, declared, dryRun);
    // Reconciliación automática: si un placeholder sintético ya tiene su
    // partido real (con idp), eliminarlo para no duplicar en la web.
    const reconciled = await reconcileSyntheticMatches();
    if (reconciled > 0) log.info({ reconciled }, '🧹 Placeholders sintéticos reconciliados');
  }

  // ── Clasificación ─────────────────────────────────
  if (entity === 'standings' || entity === 'all') {
    await processStandings(idc, competitionName, pipeline, undefined, CUP_IDCS, dryRun);
  }

  // ── Marcadores en vivo ──────────────────────────────
  if (entity === 'matches' || entity === 'all') {
    log.info('→ Scrapeando marcadores rfep_mc_1.php...');
    const scraper = new FepMatchesScraper({ seasonId: seasonId! });
    const result = await scraper.run();
    log.info({ found: result.data.length, errors: result.errors.length }, 'Marcadores scrapeados');
    if (result.data.length > 0) {
      const etl = await pipeline.runMatches(result);
      log.info(etl, '✅ Marcadores cargados');
    }
  }

  // ── Fichas pendientes en bloque (o TODAS con --entity=refichas) ──────
  // fichas-pendientes: solo partidos sin eventos cargados.
  // refichas: re-procesa todas las actas de la temporada (idempotente) —
  // útil tras mejorar el parser (penaltis, staff, lanzadores...).
  if (entity === 'fichas-pendientes' || entity === 'refichas') {
    // En modo multi (flag activo, sin --season-id), el barrido de respaldo cubre
    // TODAS las competiciones FEP activas, no sólo la del entorno. Así las 15
    // ligas de la Fase 2 recuperan actas que el directo no capturara.
    // WSG/europeos: resolveWorldskate añade las ediciones World Skate en
    // ventana (sus partidos también se quedan sin ficha cuando terminan
    // fuera del bucle de directo — 5 partidos del Mundial F del 6/10/2026).
    const seasons = wantsMulti
      ? (await getActiveScrapePlan(FEP_SCRAPER_KEY))
          .map((p) => p.seasonId)
          .filter((s): s is string => s !== null)
      : [seasonId!];
    if (wantsMulti) {
      const { active } = await resolveWorldskate();
      for (const ctx of active) {
        if (!seasons.includes(ctx.seasonId)) seasons.push(ctx.seasonId);
      }
    }
    log.info({ seasons: seasons.length, multi: wantsMulti }, '→ Barrido de fichas pendientes');

    const { rows: pending } = await db.query<{
      id: string;
      source_ref: string;
      home_team_name: string | null;
      comp_ref: string | null;
    }>(
      `SELECT m.id, m.source_ref, ht.name AS home_team_name,
              comp.source_ref AS comp_ref
       FROM matches m
       LEFT JOIN teams ht ON ht.id = m.home_team_id
       JOIN seasons s ON s.id = m.season_id
       JOIN competitions comp ON comp.id = s.competition_id
       WHERE m.season_id = ANY($1)
         AND m.status IN ('finished', 'live')
         AND m.source_ref LIKE ANY($3)
         AND ($2 OR NOT EXISTS (SELECT 1 FROM match_events e WHERE e.match_id = m.id))
       ORDER BY m.scheduled_at ASC`,
      [seasons, entity === 'refichas', matchRefLikePatterns()]
    );

    log.info({ pending: pending.length }, '→ Fichas pendientes encontradas');

    // TOPE por run (#331): el barrido sin límite puede sostener el lock HORAS
    // (1,5 s/ficha × cientos de pendientes) — mecanismo plausible del gap de
    // 6 h del 13/09: durante el barrido, cron-live y calendar/standings no
    // entraban. Con tope + ORDER BY scheduled_at, el resto continúa en el
    // siguiente ciclo diario. Ajustable; 0 = sin tope.
    const MAX_FICHAS = Number(process.env['ETL_MAX_FICHAS_PER_RUN'] ?? 300);
    const procesar = MAX_FICHAS > 0 ? pending.slice(0, MAX_FICHAS) : pending;
    if (procesar.length < pending.length) {
      log.warn(
        { tope: MAX_FICHAS, pendientes: pending.length, procesando: procesar.length },
        'Barrido de fichas recortado al tope del run — el resto continúa mañana (#331)'
      );
    }

    // RASTRO del run (#331): fila 'running' al inicio y UPDATE al final. Un run
    // abortado deja la fila en 'running' — la señal que antes no existía.
    const runId = await startScrapeRun({
      scraperKey: FEP_SCRAPER_KEY,
      entityType: 'match_event',
      entityRef: `${entity}(${procesar.length}/${pending.length})`,
    }).catch((err) => {
      log.warn({ err }, 'No se pudo registrar el run del barrido de fichas');
      return null;
    });

    let ok = 0, fail = 0, omitidas = 0;
    const startedAt = Date.now();

    for (const m of procesar) {
      // Resolución multi-fuente (#333): FEP y World Skate (wse_match_/wse_competition_)
      // comparten el FepFichaScraper parametrizado por fuente.
      const ids = resolveMatchSourceIds(m.source_ref, m.comp_ref);
      if (!ids) {
        log.warn({ sourceRef: m.source_ref, compRef: m.comp_ref }, 'Fuente/idp no reconocido — ficha omitida');
        omitidas++;
        continue;
      }
      try {
        const scraper = new FepFichaScraper({
          idp: ids.idp,
          idc: ids.idc,
          source: ids.source,
          homeTeamName: m.home_team_name ?? undefined,
          matchId: m.id,
        });
        const result = await scraper.run();
        log.info({ idp: ids.idp, source: ids.source.key, events: result.data.length }, '✅ Ficha procesada');
        ok++;
      } catch (err) {
        log.error({ idp: ids.idp, err }, '❌ Error en ficha — continuando con la siguiente');
        fail++;
      }
      // Pausa de cortesía con la fuente
      await new Promise((r) => setTimeout(r, 1500));
    }

    if (runId) {
      await finishScrapeRun(runId, {
        status: fail === 0 ? 'success' : ok === 0 ? 'error' : 'partial',
        recordsFound: procesar.length,
        recordsUpserted: ok,
        errorMessage: fail > 0 ? `${fail} fichas fallaron de ${procesar.length}` : undefined,
        durationMs: Date.now() - startedAt,
      }).catch((err) => log.warn({ err }, 'No se pudo cerrar el run del barrido de fichas'));
    }

    log.info({ ok, fail, omitidas, total: procesar.length, pendientesRestantes: pending.length - procesar.length }, '🏁 Fichas pendientes completadas');
  }

  // ── Ficha resumen (eventos de partido) ─────────────────
  if (entity === 'ficha') {
    const sourceRefArg = args['source-ref'];
    if (!sourceRefArg) {
      log.error('--source-ref=fep_match_{idp} requerido para entity=ficha');
      process.exit(1);
    }

    // Buscar el partido en DB por source_ref para obtener su UUID y equipo local
    const { rows: matchRows } = await db.query<{
      id: string;
      source_ref: string;
      home_team_name: string | null;
      idc: string | null;
    }>(
      `SELECT m.id, m.source_ref, ht.name AS home_team_name,
              comp.source_ref AS idc
       FROM matches m
       LEFT JOIN teams      ht   ON ht.id   = m.home_team_id
       LEFT JOIN seasons    s    ON s.id    = m.season_id
       LEFT JOIN competitions comp ON comp.id = s.competition_id
       WHERE m.source_ref = $1`,
      [sourceRefArg]
    );

    if (matchRows.length === 0) {
      log.error({ sourceRef: sourceRefArg }, 'Partido no encontrado en DB');
      process.exit(1);
    }
    const match = matchRows[0]!;
    log.info({ matchId: match.id, sourceRef: match.source_ref, homeTeam: match.home_team_name }, 'Scrapeando ficha');

    // Resolución multi-fuente (#333): FEP y World Skate comparten el ficha
    const ids = resolveMatchSourceIds(match.source_ref, match.idc ?? idc);
    if (!ids) {
      log.error({ sourceRef: match.source_ref }, 'Fuente no reconocida para este source_ref');
      process.exit(1);
    }
    log.info({ idp: ids.idp, idc: ids.idc, source: ids.source.key }, 'IDs para el endpoint de ficha');

    // Pasar matchId al scraper para que inyecte directamente en match_events
    // en cuanto encuentre el endpoint activo (evita un segundo paso ETL)
    const scraper = new FepFichaScraper({
      idp: ids.idp,
      idc: ids.idc,
      source: ids.source,
      homeTeamName: match.home_team_name ?? undefined,
      matchId: match.id,
    });
    const result = await scraper.run();
    log.info({ found: result.data.length, errors: result.errors.length }, 'Ficha scrapeada');

    if (result.errors.length > 0) {
      log.warn({ errors: result.errors }, 'Errores durante scraping de ficha');
    }

    // La inyeccion en match_events ya fue realizada por el scraper internamente
    // (via FepFichaScraper.injectEvents) en cuanto encontro el endpoint activo.
    // Solo logueamos el recuento final aqui.
    log.info({ matchId: match.id, eventsFound: result.data.length }, '✅ Ficha de partido procesada');
  }

  // ── Sincronización de escudos ──────────────────────
  // Una sola implementación (`team-logos.ts`), basada en `teams.logo_url` como
  // fuente de verdad. Antes era un mapa de 14 equipos hardcodeado aquí: el
  // scheduler solo ejecutaba esto, así que el resto de equipos se quedaban sin
  // fichero local y pagaban BD+CDN en cada visita (incidente 2026-10-05).
  if (entity === 'download-logos') {
    const summary = await downloadTeamLogos();
    log.info(summary, 'Sincronización de escudos completada');
  }

  log.info('🏁 Pipeline completado');
}

main()
  .catch((err) => { log.error({ err }, 'Error fatal'); Sentry.captureException(err); process.exitCode = 1; })
  .finally(async () => {
    logEgressSummary(log, 'info');
    await Sentry.flush(2000);
    await closeDb();
  });

/** Ciudad del pabellón desde el club local (ver fillVenueCity). Nunca tumba el pipeline. */
async function fillVenueCitySafe(): Promise<void> {
  try {
    const n = await fillVenueCity();
    if (n > 0) log.info({ partidos: n }, '📍 Ciudad del pabellón completada');
  } catch (err) {
    log.warn({ err }, 'No se pudo completar la ciudad del pabellón — sigue');
  }
}

/**
 * Scrape + ETL de todas las competiciones activas de World Skate.
 *
 * Vive aquí, y no en `apps/scraper/src/index.ts`, porque lo necesitan DOS
 * llamantes:
 *
 *   · `deploy/etl-scheduler.sh` cada 5 min (vía `--run-once worldskate`), que
 *     cubre el caso de reposo: cambios de calendario, horas, altas de equipos.
 *   · `cron-live.ts` en CADA ciclo de su bucle activo (~45 s), que es lo que da
 *     directo de verdad durante los partidos.
 *
 * Por qué hizo falta lo segundo: el bucle de `etl-scheduler.sh` es SECUENCIAL, y
 * `cron-live` se queda dentro de su bucle activo mientras haya partidos en
 * juego (hasta 180 min). Con World Skate detrás de él en la lista, no le
 * llegaba el turno. Y como el estado `live` de WSE se infería entonces de la
 * hora (3 h), los partidos se quedaban colgados "EN JUEGO" — lo que a su vez
 * mantenía a `cron-live` en el bucle e impedía la ejecución que lo habría
 * arreglado. Un círculo vicioso. (Desde la migración 072 el estado sale del
 * match center de la fuente — `playing`/`final`/`pending` —, no de la hora.)
 *
 * #294 — ediciones terminadas: sidgad retira la página del calendario poco
 * después de que acabe el torneo. Seguir pidiéndola da 404 cada ciclo (14 días
 * silenciosos en el caso real). `resolveWorldskate` filtra por ventana temporal
 * (ver `wse-season-window.ts`): las ediciones dormidas se omiten, se registran
 * como `skipped` en `scrape_logs` (para no confundir al vigilante con una
 * fuente parada) y se avisa UNA vez.
 */
import { db, insertScrapeLog, reconcileSyntheticMatches } from '@sports/db';
import * as Sentry from '@sentry/node';
import { createLogger } from '@sports/logger';
import { WorldskateScraper } from './worldskate.scraper.js';
import { partitionWseSeasons, isDormantReportDue } from './wse-season-window.js';

const log = createLogger({ service: 'worldskate' });

const WORLDSKATE_SCRAPER_KEY = 'worldskate_hockey';
/** Días de margen tras el fin de una edición antes de dejar de scrapearla. */
const WSE_SCRAPE_GRACE_DAYS = Number(process.env['WSE_SCRAPE_GRACE_DAYS'] ?? 3);
/** Re-aviso máximo de la desactivación (evita spam si el proceso es corto). */
const DORMANT_REALERT_HOURS = Number(process.env['WSE_DORMANT_REALERT_HOURS'] ?? 24);

export interface WorldskateCtx {
  seasonId: string;
  sourceId: string;
  timezone: string | null;
  idc: string;
  name: string;
  /** Fin de la edición (para decidir si sigue en ventana). */
  endDate: string | Date | null;
}

type ScrapeOut = Awaited<ReturnType<WorldskateScraper['run']>>;

/**
 * El pipeline se INYECTA en vez de importarse. Este fichero vive en el paquete
 * del scraper y lo consume también `apps/etl`; si importara `@sports/etl`, ese
 * paquete acabaría importándose a sí mismo por nombre y el typecheck de
 * `@sports/etl` no resolvería el módulo. Además es la dirección correcta de la
 * dependencia: el scraper no tiene por qué saber nada del ETL.
 *
 * `EtlPipeline` encaja estructuralmente, así que en la práctica se pasa tal cual.
 */
export interface WorldskatePipeline {
  runRounds(result: ScrapeOut['rounds']): Promise<{ upserted: number }>;
  runMatches(result: ScrapeOut['matches']): Promise<{ upserted: number }>;
  runStandings(result: ScrapeOut['standings']): Promise<{ upserted: number }>;
}

/** Construye el pipeline de una temporada. Lo aporta el llamante. */
export type PipelineFactory = (seasonId: string) => WorldskatePipeline;

export interface WorldskateResolution {
  /** Ediciones en ventana: hay que scrapearlas. */
  active: WorldskateCtx[];
  /** Ediciones terminadas: sidgad ya retiró su página. */
  dormant: WorldskateCtx[];
}

/** Competiciones World Skate con temporada actual, separadas por ventana. */
export async function resolveWorldskate(now: Date = new Date()): Promise<WorldskateResolution> {
  try {
    const res = await db.query<{
      season_id: string; timezone: string | null; source_id: string;
      comp_ref: string; comp_name: string; end_date: string | Date | null;
    }>(`
      SELECT s.id AS season_id, s.timezone, s.end_date, ds.id AS source_id,
             c.source_ref AS comp_ref, c.name AS comp_name
      FROM seasons s
      JOIN competitions c   ON c.id = s.competition_id
      JOIN data_sources ds  ON ds.scraper_key = 'worldskate_hockey'
      WHERE c.source_ref LIKE 'wse_competition_%'
        AND s.is_current = TRUE
    `);
    const all: WorldskateCtx[] = res.rows.map((row) => ({
      seasonId: row.season_id,
      sourceId: row.source_id,
      timezone: row.timezone,
      idc: row.comp_ref.replace('wse_competition_', ''),
      name: row.comp_name,
      endDate: row.end_date ?? null,
    }));
    return partitionWseSeasons(now, all, WSE_SCRAPE_GRACE_DAYS);
  } catch (err) {
    log.error({ err }, 'Error resolviendo competiciones World Skate');
    return { active: [], dormant: [] };
  }
}

/**
 * Momento del último registro `skipped` de World Skate (si lo hay). Se consulta
 * sólo por `skipped` (no por el último run en general): si otra edición está
 * activa, su run `success` sobrescribe el último resumen y no debe hacer creer
 * que la desactivación aún no se ha avisado → spam en cada ciclo.
 */
async function lastDormantReportAt(): Promise<Date | null> {
  const { rows } = await db.query<{ scraped_at: Date }>(
    `SELECT scraped_at FROM scrape_logs
      WHERE scraper_key = $1 AND entity_type = 'match' AND status = 'skipped'
      ORDER BY scraped_at DESC
      LIMIT 1`,
    [WORLDSKATE_SCRAPER_KEY],
  );
  return rows[0]?.scraped_at ?? null;
}

/**
 * Registra y avisa (una vez) de las ediciones fuera de ventana. Best-effort:
 * nunca debe romper el pipeline. Las filas `skipped` mantienen fresco el último
 * resumen de `scrape_logs` para que `scrape-health-watch` no lo lea como "fuente
 * parada" y dispare un falso positivo.
 */
export async function reportDormantWorldskate(dormant: WorldskateCtx[]): Promise<void> {
  if (dormant.length === 0) return;
  const idcs = dormant.map((c) => c.idc);

  log.info(
    {
      competitions: dormant.map((c) => ({ idc: c.idc, name: c.name })),
      reason: 'edición finalizada — sidgad retira el calendario',
    },
    'World Skate: ediciones fuera de ventana — scraper omitido (sin 404)',
  );

  try {
    const lastAt = await lastDormantReportAt();
    const due = isDormantReportDue(
      lastAt ? { status: 'skipped', scrapedAt: lastAt } : null,
      new Date(),
      DORMANT_REALERT_HOURS,
    );
    if (!due) return;

    for (const entityType of ['match', 'standing']) {
      await insertScrapeLog({
        scraperKey: WORLDSKATE_SCRAPER_KEY,
        entityType,
        status: 'skipped',
        entityRef: idcs.join(','),
        recordsFound: 0,
      });
    }

    Sentry.captureMessage(
      `World Skate: ${dormant.length} edición(es) sin competición en curso (idc ${idcs.join(', ')}) — scraper desactivado hasta la próxima`,
      {
        level: 'warning',
        fingerprint: ['wse-dormant'],
        tags: { source: 'worldskate' },
        extra: { idc: idcs },
      },
    );
  } catch (err) {
    log.warn({ err }, 'No se pudo registrar/alertar la desactivación de World Skate (best-effort)');
  }
}

export interface WorldskateRunResult {
  upserted: number;
  /** true = scrape OK en matches y standings. */
  ok: boolean;
  /** `source_ref` que el match center da EN JUEGO en este scrape. */
  liveRefs: string[];
}

/** Scrape + ETL de UNA competición. */
export async function runWorldskate(
  ctx: WorldskateCtx,
  makePipeline: PipelineFactory,
): Promise<WorldskateRunResult> {
  const scraper = new WorldskateScraper({
    idc: ctx.idc,
    seasonId: ctx.seasonId,
    sourceId: ctx.sourceId,
    timezone: ctx.timezone ?? undefined,
    competitionName: ctx.name,
  });
  const out = await scraper.run();
  const ok = out.matches.success && out.standings.success;

  if (!ok) {
    const failedEntities: Array<'match' | 'standing'> = [];
    if (!out.matches.success) failedEntities.push('match');
    if (!out.standings.success) failedEntities.push('standing');
    const messages = [...out.matches.errors, ...out.standings.errors]
      .map((e) => e.message)
      .filter(Boolean);
    const errorMessage = (messages.join(' | ') || 'scrape sin detalle').slice(0, 500);

    log.error(
      { competition: ctx.name, idc: ctx.idc, errors: messages },
      'Scrape World Skate falló — registrado y alertado',
    );

    // El loader NO corre cuando el scrape falla, así que sin esta fila el fallo
    // quedaría invisible en scrape_logs (fue justo lo que pasó #294). El
    // vigilante diario la verá como status='error' y alertará.
    try {
      for (const entityType of failedEntities) {
        await insertScrapeLog({
          sourceId: ctx.sourceId,
          scraperKey: WORLDSKATE_SCRAPER_KEY,
          entityType,
          status: 'error',
          recordsFound: 0,
          errorMessage,
        });
      }
    } catch (err) {
      log.warn({ err }, 'No se pudo registrar el error de World Skate en scrape_logs');
    }

    // Fingerprint estable: un solo issue por edición, aunque falle cada ciclo.
    Sentry.captureException(
      new Error(`Scrape World Skate falló (${ctx.name}, idc ${ctx.idc}): ${errorMessage}`),
      {
        fingerprint: ['wse-scrape-fail', ctx.idc],
        tags: { source: 'worldskate' },
        extra: { idc: ctx.idc, errors: messages },
      },
    );
  }

  const pipeline = makePipeline(ctx.seasonId);
  // Las rondas ANTES de los partidos: la estructura de fases (incluidas las
  // eliminatorias con participantes aún sin publicar) existe desde el primer
  // scrape, aunque sus partidos lleguen cuando la fuente publique equipos.
  const rEtl = out.rounds.success ? await pipeline.runRounds(out.rounds) : { upserted: 0 };
  const mEtl = out.matches.success   ? await pipeline.runMatches(out.matches)     : { upserted: 0 };
  const sEtl = out.standings.success ? await pipeline.runStandings(out.standings) : { upserted: 0 };
  // Placeholders sintéticos que ya sobran en esta temporada: su ref incluye la
  // hora, así que un cambio de hora de la fuente (o la corrección de la zona
  // horaria de Asunción, UTC-4 → UTC-3) deja el viejo al lado del nuevo y el
  // cuadro enseña el partido dos veces (caso real WSG femenino, 10/10/2026).
  let reconciled = 0;
  if (out.matches.success) {
    try { reconciled = await reconcileSyntheticMatches(ctx.seasonId); }
    catch (err) { log.warn({ err, competition: ctx.name }, 'Reconciliación de sintéticos falló — el ciclo sigue'); }
  }

  log.info(
    { competition: ctx.name, idc: ctx.idc, ok,
      roundsUpserted: rEtl.upserted,
      matchesFound: out.matches.data.length, matchesUpserted: mEtl.upserted,
      standingsFound: out.standings.data.length, standingsUpserted: sEtl.upserted, reconciled },
    'World Skate ETL'
  );
  const liveRefs = out.matches.data
    .filter((m) => m.status === 'live' && m.sourceRef)
    .map((m) => m.sourceRef!);
  return { upserted: mEtl.upserted, ok, liveRefs };
}

/**
 * Todas las competiciones en ventana. Aislado por competición: si una falla, las
 * demás siguen. Devuelve cuántos partidos se actualizaron en total.
 */
export async function runAllWorldskate(makePipeline: PipelineFactory): Promise<number> {
  const { active, dormant } = await resolveWorldskate();
  await reportDormantWorldskate(dormant);

  if (active.length === 0) {
    log.debug('World Skate: sin competiciones en ventana — nada que hacer');
    return 0;
  }
  let total = 0;
  for (const ctx of active) {
    try {
      total += (await runWorldskate(ctx, makePipeline)).upserted;
    } catch (err) {
      log.warn({ err, competition: ctx.name, idc: ctx.idc }, 'World Skate falló — sigue con la siguiente');
    }
  }
  return total;
}

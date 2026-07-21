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
 * llegaba el turno. Y como el estado `live` de WSE se infiere de la hora y sólo
 * dura 3 h, los partidos se quedaban colgados "EN JUEGO" — lo que a su vez
 * mantenía a `cron-live` en el bucle e impedía la ejecución que lo habría
 * arreglado. Un círculo vicioso.
 */
import { db } from '@sports/db';
import { createLogger } from '@sports/logger';
import { WorldskateScraper } from './worldskate.scraper.js';

const log = createLogger({ service: 'worldskate' });

export interface WorldskateCtx {
  seasonId: string;
  sourceId: string;
  timezone: string | null;
  idc: string;
  name: string;
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
  runMatches(result: ScrapeOut['matches']): Promise<{ upserted: number }>;
  runStandings(result: ScrapeOut['standings']): Promise<{ upserted: number }>;
}

/** Construye el pipeline de una temporada. Lo aporta el llamante. */
export type PipelineFactory = (seasonId: string) => WorldskatePipeline;

/** Competiciones World Skate con temporada actual. Vacío fuera de torneo. */
export async function resolveWorldskate(): Promise<WorldskateCtx[]> {
  try {
    const res = await db.query<{
      season_id: string; timezone: string | null; source_id: string;
      comp_ref: string; comp_name: string;
    }>(`
      SELECT s.id AS season_id, s.timezone, ds.id AS source_id,
             c.source_ref AS comp_ref, c.name AS comp_name
      FROM seasons s
      JOIN competitions c   ON c.id = s.competition_id
      JOIN data_sources ds  ON ds.scraper_key = 'worldskate_hockey'
      WHERE c.source_ref LIKE 'wse_competition_%'
        AND s.is_current = TRUE
    `);
    return res.rows.map((row) => ({
      seasonId: row.season_id,
      sourceId: row.source_id,
      timezone: row.timezone,
      idc: row.comp_ref.replace('wse_competition_', ''),
      name: row.comp_name,
    }));
  } catch (err) {
    log.error({ err }, 'Error resolviendo competiciones World Skate');
    return [];
  }
}

/** Scrape + ETL de UNA competición. */
export async function runWorldskate(ctx: WorldskateCtx, makePipeline: PipelineFactory): Promise<number> {
  const scraper = new WorldskateScraper({
    idc: ctx.idc,
    seasonId: ctx.seasonId,
    sourceId: ctx.sourceId,
    timezone: ctx.timezone ?? undefined,
    competitionName: ctx.name,
  });
  const out = await scraper.run();

  const pipeline = makePipeline(ctx.seasonId);
  const mEtl = out.matches.success   ? await pipeline.runMatches(out.matches)     : { upserted: 0 };
  const sEtl = out.standings.success ? await pipeline.runStandings(out.standings) : { upserted: 0 };

  log.info(
    { competition: ctx.name, idc: ctx.idc,
      matchesFound: out.matches.data.length, matchesUpserted: mEtl.upserted,
      standingsFound: out.standings.data.length, standingsUpserted: sEtl.upserted },
    'World Skate ETL'
  );
  return mEtl.upserted;
}

/**
 * Todas las competiciones activas. Aislado por competición: si una falla, las
 * demás siguen. Devuelve cuántos partidos se actualizaron en total.
 */
export async function runAllWorldskate(makePipeline: PipelineFactory): Promise<number> {
  const comps = await resolveWorldskate();
  if (comps.length === 0) {
    log.debug('World Skate: sin competiciones actuales — nada que hacer');
    return 0;
  }
  let total = 0;
  for (const ctx of comps) {
    try {
      total += await runWorldskate(ctx, makePipeline);
    } catch (err) {
      log.warn({ err, competition: ctx.name, idc: ctx.idc }, 'World Skate falló — sigue con la siguiente');
    }
  }
  return total;
}

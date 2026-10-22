/**
 * Scrape + ETL de todas las competiciones FPP activas (Portugal).
 *
 * Data-driven: lee `competition_sources` (scraper_key = fpp_hockey) y
 * reconstruye cada competición desde `external_ids.fpp`, que escribe
 * `seed-fpp.ts`. Lo llama `deploy/etl-scheduler.sh` (`--run-once fpp`).
 *
 * v1 sin directo: calendario, resultados y clasificación. Un fallo en una
 * competición no para a las demás; se registra en scrape_logs y Sentry.
 */
import { db, insertScrapeLog, type ExternalIds } from '@sports/db';
import * as Sentry from '@sentry/node';
import { createLogger } from '@sports/logger';
import type { FppCompetition } from './fpp-catalog.js';
import { scrapeFppCompetition, FPP_SCRAPER_KEY, type FppScrapeOutput } from './fpp.scraper.js';

const log = createLogger({ service: 'fpp' });

export interface FppPipeline {
  runRounds(result: FppScrapeOutput['rounds']): Promise<{ upserted: number }>;
  runMatches(result: FppScrapeOutput['matches']): Promise<{ upserted: number }>;
  runStandings(result: FppScrapeOutput['standings']): Promise<{ upserted: number }>;
}
export type FppPipelineFactory = (seasonId: string) => FppPipeline;

export interface FppCtx {
  comp: FppCompetition;
  seasonId: string;
  sourceId: string;
  timezone: string | null;
}

/** Competiciones FPP activas con temporada actual. */
export async function resolveFpp(): Promise<FppCtx[]> {
  const { rows } = await db.query<{
    name: string; short_name: string | null; slug: string; age_category: string;
    timezone: string | null; season_id: string | null; source_id: string; external_ids: ExternalIds;
  }>(
    `SELECT c.name, c.short_name, c.slug, c.age_category, c.timezone,
            s.id AS season_id, cs.source_id, cs.external_ids
       FROM competition_sources cs
       JOIN competitions c  ON c.id = cs.competition_id
       JOIN data_sources ds ON ds.id = cs.source_id AND ds.scraper_key = $1
       LEFT JOIN seasons s  ON s.competition_id = c.id AND s.is_current = TRUE
      WHERE cs.is_active = TRUE
      ORDER BY c.name`,
    [FPP_SCRAPER_KEY],
  );
  const out: FppCtx[] = [];
  for (const r of rows) {
    const fpp = r.external_ids.fpp;
    if (!fpp || !r.season_id) {
      log.warn({ competition: r.name }, 'Competición FPP sin external_ids.fpp o sin temporada actual — omitida');
      continue;
    }
    out.push({
      seasonId: r.season_id,
      sourceId: r.source_id,
      timezone: r.timezone,
      comp: {
        key: fpp.key, name: r.name, shortName: r.short_name ?? r.name, slug: r.slug,
        gender: fpp.gender, teamAge: fpp.teamAge as FppCompetition['teamAge'],
        competitionAge: r.age_category as FppCompetition['competitionAge'],
        format: r.external_ids.format ?? 'league',
        sections: fpp.sections,
      },
    });
  }
  return out;
}

export async function runFpp(ctx: FppCtx, makePipeline: FppPipelineFactory): Promise<{ ok: boolean; upserted: number }> {
  const out = await scrapeFppCompetition(ctx.comp, ctx);
  const ok = out.matches.success && out.standings.success;
  if (!ok) {
    const msg = (out.matches.errors.map((e) => e.message).join(' | ') || 'scrape sin detalle').slice(0, 500);
    try {
      for (const entityType of ['match', 'standing']) {
        await insertScrapeLog({
          sourceId: ctx.sourceId, scraperKey: FPP_SCRAPER_KEY, entityType,
          status: 'error', entityRef: ctx.comp.key, recordsFound: 0, errorMessage: msg,
        });
      }
    } catch (err) {
      log.warn({ err }, 'No se pudo registrar el error FPP en scrape_logs');
    }
    Sentry.captureException(new Error(`Scrape FPP falló (${ctx.comp.name}): ${msg}`), {
      fingerprint: ['fpp-scrape-fail', ctx.comp.key],
      tags: { source: 'fpp' },
    });
    return { ok: false, upserted: 0 };
  }

  const pipeline = makePipeline(ctx.seasonId);
  // Rondas antes que partidos: la estructura existe aunque falten cruces.
  const r = await pipeline.runRounds(out.rounds);
  const m = await pipeline.runMatches(out.matches);
  const s = out.standings.data.length > 0 ? await pipeline.runStandings(out.standings) : { upserted: 0 };
  log.info(
    { competition: ctx.comp.name, rounds: r.upserted, matchesFound: out.matches.data.length,
      matchesUpserted: m.upserted, standingsUpserted: s.upserted },
    'FPP ETL',
  );
  return { ok: true, upserted: m.upserted };
}

export async function runAllFpp(makePipeline: FppPipelineFactory): Promise<number> {
  const ctxs = await resolveFpp();
  if (ctxs.length === 0) {
    log.info('FPP: sin competiciones activas (¿falta ejecutar seed-fpp --write?)');
    return 0;
  }
  let total = 0;
  for (const ctx of ctxs) {
    try {
      total += (await runFpp(ctx, makePipeline)).upserted;
    } catch (err) {
      log.warn({ err, competition: ctx.comp.name }, 'FPP falló — sigue con la siguiente');
      Sentry.captureException(err, { fingerprint: ['fpp-run-fail', ctx.comp.key], tags: { source: 'fpp' } });
    }
  }
  return total;
}

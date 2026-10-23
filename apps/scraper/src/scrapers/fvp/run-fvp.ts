/**
 * Scrape + ETL de las competiciones vascas activas (Federación Vasca de
 * Patinaje, API DigitalSport). Data-driven: lee `competition_sources`
 * (scraper_key = fvp_hockey, `external_ids.fvp` lo escribe seed-fvp.ts).
 * Lo llama el scheduler con `--run-once fvp`. Un fallo en una competición no
 * para a las demás: queda en scrape_logs y Sentry.
 */
import { db, insertScrapeLog, type ExternalIds } from '@sports/db';
import * as Sentry from '@sentry/node';
import { createLogger } from '@sports/logger';
import { FVP_SCRAPER_KEY, type FvpCompetition, type FvpAge } from './fvp-catalog.js';
import { scrapeFvpCompetition, type FvpScrapeOutput } from './fvp.scraper.js';
import { runFvpFichas } from './fvp-ficha.js';

const log = createLogger({ service: 'fvp' });

export interface FvpPipeline {
  runRounds(result: FvpScrapeOutput['rounds']): Promise<{ upserted: number }>;
  runMatches(result: FvpScrapeOutput['matches']): Promise<{ upserted: number }>;
  runStandings(result: FvpScrapeOutput['standings']): Promise<{ upserted: number }>;
}
export type FvpPipelineFactory = (seasonId: string) => FvpPipeline;

export interface FvpCtx { comp: FvpCompetition; seasonId: string; sourceId: string; timezone: string | null }

export async function resolveFvp(): Promise<FvpCtx[]> {
  const { rows } = await db.query<{
    name: string; short_name: string | null; slug: string; timezone: string | null;
    season_id: string | null; season_name: string | null; source_id: string; external_ids: ExternalIds;
  }>(
    `SELECT c.name, c.short_name, c.slug, c.timezone, s.id AS season_id, s.name AS season_name,
            cs.source_id, cs.external_ids
       FROM competition_sources cs
       JOIN competitions c  ON c.id = cs.competition_id
       JOIN data_sources ds ON ds.id = cs.source_id AND ds.scraper_key = $1
       LEFT JOIN seasons s  ON s.competition_id = c.id AND s.is_current = TRUE
      WHERE cs.is_active = TRUE
      ORDER BY c.name`,
    [FVP_SCRAPER_KEY],
  );
  const out: FvpCtx[] = [];
  for (const r of rows) {
    const fvp = r.external_ids.fvp;
    if (!fvp || !r.season_id) {
      log.warn({ competition: r.name }, 'Competición FVP sin external_ids.fvp o sin temporada actual — omitida');
      continue;
    }
    out.push({
      seasonId: r.season_id, sourceId: r.source_id, timezone: r.timezone,
      comp: {
        apiId: fvp.apiId, key: fvp.key, name: r.name, shortName: r.short_name ?? r.name, slug: r.slug,
        gender: fvp.gender, age: fvp.age as FvpAge, teamScope: fvp.teamScope, isCup: fvp.isCup, nameAliases: fvp.nameAliases,
        season: { code: '', name: r.season_name ?? '', slug: '', start: '', end: '' },
      },
    });
  }
  return out;
}

export async function runFvp(ctx: FvpCtx, makePipeline: FvpPipelineFactory): Promise<{ ok: boolean; upserted: number }> {
  const out = await scrapeFvpCompetition(ctx.comp, ctx);
  if (out.unknownStates.length > 0) {
    Sentry.captureMessage(`FVP: estados de partido desconocidos (${out.unknownStates.join(', ')}) en ${ctx.comp.name}`, {
      level: 'warning', fingerprint: ['fvp-estado', ...out.unknownStates], tags: { source: 'fvp' },
    });
  }
  const ok = out.matches.success && out.standings.success;
  if (!ok) {
    const msg = (out.matches.errors.map((e) => e.message).join(' | ') || 'scrape sin detalle').slice(0, 500);
    try {
      for (const entityType of ['match', 'standing']) {
        await insertScrapeLog({
          sourceId: ctx.sourceId, scraperKey: FVP_SCRAPER_KEY, entityType,
          status: 'error', entityRef: ctx.comp.key, recordsFound: 0, errorMessage: msg,
        });
      }
    } catch (err) {
      log.warn({ err }, 'No se pudo registrar el error FVP en scrape_logs');
    }
    Sentry.captureException(new Error(`Scrape FVP falló (${ctx.comp.name}): ${msg}`), {
      fingerprint: ['fvp-scrape-fail', ctx.comp.key], tags: { source: 'fvp' },
    });
    return { ok: false, upserted: 0 };
  }

  // Mientras un partido está EN JUEGO, el directo es el dueño de su estado y marcador.
  const live = await db.query<{ source_ref: string }>(
    `SELECT source_ref FROM matches WHERE season_id = $1 AND status = 'live' AND source_ref LIKE 'fvp\\_match\\_%'`,
    [ctx.seasonId],
  );
  if (live.rows.length > 0) {
    const liveRefs = new Set(live.rows.map((r) => r.source_ref));
    for (const m of out.matches.data) {
      if (m.sourceRef && liveRefs.has(m.sourceRef)) {
        (m as { status?: unknown }).status = undefined;
        m.homeScore = undefined;
        m.awayScore = undefined;
      }
    }
  }

  const pipeline = makePipeline(ctx.seasonId);
  const r = await pipeline.runRounds(out.rounds);
  const m = await pipeline.runMatches(out.matches);
  const s = out.standings.data.length > 0 ? await pipeline.runStandings(out.standings) : { upserted: 0 };
  log.info({ competition: ctx.comp.name, rounds: r.upserted, matchesFound: out.matches.data.length,
    matchesUpserted: m.upserted, standingsUpserted: s.upserted }, 'FVP ETL');
  return { ok: true, upserted: m.upserted };
}

export async function runAllFvp(makePipeline: FvpPipelineFactory): Promise<number> {
  const ctxs = await resolveFvp();
  if (ctxs.length === 0) {
    log.info('FVP: sin competiciones activas (¿falta ejecutar seed-fvp --write?)');
    return 0;
  }
  let total = 0;
  for (const ctx of ctxs) {
    try {
      total += (await runFvp(ctx, makePipeline)).upserted;
    } catch (err) {
      log.warn({ err, competition: ctx.comp.name }, 'FVP falló — sigue con la siguiente');
      Sentry.captureException(err, { fingerprint: ['fvp-run-fail', ctx.comp.key], tags: { source: 'fvp' } });
    }
  }
  try {
    await runFvpFichas();
  } catch (err) {
    log.warn({ err }, 'Actas FVP fallaron (el calendario ya está cargado)');
  }
  return total;
}

/**
 * Punto de entrada del scraper.
 *
 * Cada cron hace scrape + ETL en un solo paso:
 *   1. Scraper recoge datos crudos de sidgad.es
 *   2. EtlPipeline transforma y persiste en PostgreSQL
 *
 * Competiciones:
 *   idc=3150 — OK Liga Masculina
 *   idc=3481 — OK Liga Masculina Playoff (activo desde abril 2025)
 */
import cron from 'node-cron';
import { createLogger } from '@sports/logger';
import { db, closeDb } from '@sports/db';
import { analytics, shutdownAnalytics } from '@sports/analytics';
import { EtlPipeline } from '@sports/etl';
import { FepCalendarScraper }    from './scrapers/fep/fep-calendar.scraper.js';
import { FepStandingsScraper }   from './scrapers/fep/fep-standings.scraper.js';
import { FepMatchesScraper }     from './scrapers/fep/fep-matches.scraper.js';
import { FepCompetitionsScraper } from './scrapers/fep/fep-competitions.scraper.js';
import { FepListadoScraper }     from './scrapers/fep/fep-listado.scraper.js';
import { WorldskateScraper }     from './scrapers/worldskate/worldskate.scraper.js';
import { closeBrowser }          from './core/browser.js';

const log = createLogger({ service: 'scraper' });

const IDC_OK_LIGA = '3150';
const IDC_PLAYOFF = '3481';

// ─── Lookup de season IDs desde DB ───────────────────────────────────────────

interface SeasonLookup {
  okLigaSeasonId: string;
  playoffSeasonId: string | null;
}

async function resolveSeasonIds(): Promise<SeasonLookup> {
  try {
    const result = await db.query<{ id: string; comp_ref: string }>(`
      SELECT s.id, c.source_ref AS comp_ref
      FROM seasons s
      JOIN competitions c ON c.id = s.competition_id
      WHERE s.is_current = TRUE
        AND c.source_ref IN ('fep_competition_3150', 'fep_competition_3481')
    `);
    const byRef: Record<string, string> = {};
    for (const row of result.rows) byRef[row.comp_ref] = row.id;

    const okLiga  = byRef['fep_competition_3150'] ?? process.env['DEFAULT_SEASON_ID'] ?? '';
    const playoff = byRef['fep_competition_3481'] ?? process.env['PLAYOFF_SEASON_ID'] ?? null;

    log.info({ okLigaSeasonId: okLiga, playoffSeasonId: playoff ?? 'no encontrado' },
      'Season IDs resueltos desde DB');
    return { okLigaSeasonId: okLiga, playoffSeasonId: playoff };
  } catch (err) {
    log.error({ err }, 'Error resolviendo season IDs');
    return {
      okLigaSeasonId: process.env['DEFAULT_SEASON_ID'] ?? '',
      playoffSeasonId: process.env['PLAYOFF_SEASON_ID'] ?? null,
    };
  }
}

// ─── Funciones scrape+ETL por tipo ───────────────────────────────────────────

async function runCalendar(idc: string, seasonId: string, name: string) {
  const scraper  = new FepCalendarScraper({ idc, seasonId, competitionName: name });
  const result   = await scraper.run();
  if (!result.success) { log.error({ idc }, 'Calendar scrape failed'); return; }

  const pipeline = new EtlPipeline({ sportSlug: 'hockey-patines', seasonId });
  const etl      = await pipeline.runMatches(result);
  log.info({ idc, found: result.data.length, upserted: etl.upserted }, `Calendar ETL: ${name}`);
}

async function runStandings(idc: string, seasonId: string, name: string) {
  const scraper  = new FepStandingsScraper({ idc, competitionName: name });
  const result   = await scraper.run();
  if (!result.success) { log.error({ idc }, 'Standings scrape failed'); return; }

  const pipeline = new EtlPipeline({ sportSlug: 'hockey-patines', seasonId });
  const etl      = await pipeline.runStandings(result);
  log.info({ idc, found: result.data.length, upserted: etl.upserted }, `Standings ETL: ${name}`);
}

async function runLiveScores(seasonId: string) {
  const scraper  = new FepMatchesScraper({ seasonId });
  const result   = await scraper.run();
  if (!result.success) { log.error('Live scores scrape failed'); return; }

  const pipeline = new EtlPipeline({ sportSlug: 'hockey-patines', seasonId });
  const etl      = await pipeline.runMatches(result);
  log.info({
    found: result.data.length,
    upserted: etl.upserted,
    live: result.data.filter((m: { status: string }) => m.status === 'live').length,
  }, 'Live scores ETL');
}

// ─── World Skate Europe (Europeo Sub-17) ─────────────────────────────────────

interface WorldskateCtx {
  seasonId: string;
  sourceId: string;
  timezone: string | null;
  idc: string;
  name: string;
}

/**
 * Resuelve TODAS las competiciones worldskate con temporada actual (data-driven):
 * masculino (idc 320), femenino (321) y futuras. El idc sale del source_ref
 * de la competición ('wse_competition_<idc>'). Añadir una nueva = solo seed.
 */
async function resolveWorldskate(): Promise<WorldskateCtx[]> {
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
    if (res.rows.length === 0) { log.warn('World Skate: sin competiciones actuales (¿seed ejecutado?)'); }
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

async function runWorldskate(ctx: WorldskateCtx) {
  const scraper = new WorldskateScraper({
    idc: ctx.idc,
    seasonId: ctx.seasonId,
    sourceId: ctx.sourceId,
    timezone: ctx.timezone ?? undefined,
    competitionName: ctx.name,
  });
  const out = await scraper.run();

  const pipeline = new EtlPipeline({ sportSlug: 'hockey-patines', seasonId: ctx.seasonId, createRounds: true });
  const mEtl = out.matches.success ? await pipeline.runMatches(out.matches) : { upserted: 0 };
  const sEtl = out.standings.success ? await pipeline.runStandings(out.standings) : { upserted: 0 };
  log.info(
    { competition: ctx.name, idc: ctx.idc,
      matchesFound: out.matches.data.length, matchesUpserted: mEtl.upserted,
      standingsFound: out.standings.data.length, standingsUpserted: sEtl.upserted },
    'World Skate ETL'
  );
}

/** Corre todas las competiciones worldskate activas. */
async function runAllWorldskate() {
  const comps = await resolveWorldskate();
  for (const ctx of comps) await runWorldskate(ctx);
}

// ─── Definición de crons ──────────────────────────────────────────────────────

interface CronDef {
  key: string;
  cron: string;
  run: () => Promise<void>;
}

function buildCrons(seasons: SeasonLookup): CronDef[] {
  const crons: CronDef[] = [];

  // Datos estructurales — 1×/día a las 06:00
  crons.push({
    key: 'structural',
    cron: process.env['CRON_STRUCTURAL'] ?? '0 6 * * *',
    run: async () => {
      await new FepCompetitionsScraper().run();
      await new FepListadoScraper().run();
    },
  });

  // OK Liga — calendario y clasificación cada hora
  if (seasons.okLigaSeasonId) {
    crons.push({
      key: 'calendar_ok_liga',
      cron: process.env['CRON_CALENDAR'] ?? '5 * * * *',
      run: () => runCalendar(IDC_OK_LIGA, seasons.okLigaSeasonId, 'OK Liga Masculina'),
    });
    crons.push({
      key: 'standings_ok_liga',
      cron: process.env['CRON_STANDINGS'] ?? '10 * * * *',
      run: () => runStandings(IDC_OK_LIGA, seasons.okLigaSeasonId, 'OK Liga Masculina'),
    });
  }

  // Playoff — calendario y clasificación cada 15 min
  if (seasons.playoffSeasonId) {
    crons.push({
      key: 'calendar_playoff',
      cron: process.env['CRON_PLAYOFF_CALENDAR'] ?? '*/15 * * * *',
      run: () => runCalendar(IDC_PLAYOFF, seasons.playoffSeasonId!, 'OK Liga Playoff'),
    });
    crons.push({
      key: 'standings_playoff',
      cron: process.env['CRON_PLAYOFF_STANDINGS'] ?? '*/15 * * * *',
      run: () => runStandings(IDC_PLAYOFF, seasons.playoffSeasonId!, 'OK Liga Playoff'),
    });
  }

  // Marcadores en vivo — cada 2 min (todos los partidos activos)
  crons.push({
    key: 'live_scores',
    cron: process.env['CRON_LIVE'] ?? '*/2 * * * *',
    run: () => runLiveScores(seasons.okLigaSeasonId || seasons.playoffSeasonId || ''),
  });

  return crons;
}

// ─── --run-once ───────────────────────────────────────────────────────────────

async function runOnce(key: string, seasons: SeasonLookup) {
  // World Skate: corre todas las competiciones activas (masc + fem + futuras).
  if (key === 'worldskate_u17' || key === 'worldskate') {
    await runAllWorldskate();
    await Promise.all([closeBrowser(), closeDb(), shutdownAnalytics()]);
    return;
  }

  const map: Record<string, () => Promise<void>> = {
    fep_calendar_ok_liga:   () => runCalendar(IDC_OK_LIGA, seasons.okLigaSeasonId, 'OK Liga'),
    fep_standings_ok_liga:  () => runStandings(IDC_OK_LIGA, seasons.okLigaSeasonId, 'OK Liga'),
    fep_calendar_playoff:   () => runCalendar(IDC_PLAYOFF, seasons.playoffSeasonId!, 'Playoff'),
    fep_standings_playoff:  () => runStandings(IDC_PLAYOFF, seasons.playoffSeasonId!, 'Playoff'),
    fep_matches_live:       () => runLiveScores(seasons.okLigaSeasonId || seasons.playoffSeasonId || ''),
  };

  const fn = map[key];
  if (!fn) {
    log.error({ key, available: Object.keys(map) }, 'Scraper no encontrado');
    process.exit(1);
  }
  await fn();
  await Promise.all([closeBrowser(), closeDb(), shutdownAnalytics()]);
}

// ─── startScheduled ───────────────────────────────────────────────────────────

async function startScheduled(seasons: SeasonLookup) {
  const crons = buildCrons(seasons);

  // World Skate Europe — solo si hay competiciones actuales sembradas (evita
  // ruido offseason). Un único cron corre todas (masc + fem + futuras).
  const wse = await resolveWorldskate();
  if (wse.length > 0) {
    crons.push({
      key: 'worldskate',
      cron: process.env['CRON_WORLDSKATE'] ?? '*/5 * * * *',
      run: runAllWorldskate,
    });
  }

  log.info({ crons: crons.map(c => `${c.key}(${c.cron})`) }, '🚀 Scrapers programados');

  for (const def of crons) {
    cron.schedule(def.cron, async () => {
      log.info({ key: def.key }, 'Cron iniciado');
      const start = Date.now();
      try {
        await def.run();
        log.info({ key: def.key }, 'Cron completado');
        analytics.capture({
          distinctId: 'scraper-cron',
          event: 'scraper_cron_completed',
          properties: { cron_key: def.key, duration_ms: Date.now() - start, success: true },
        });
      } catch (err) {
        log.error({ key: def.key, err }, 'Error en cron');
        analytics.capture({
          distinctId: 'scraper-cron',
          event: 'scraper_cron_completed',
          properties: { cron_key: def.key, duration_ms: Date.now() - start, success: false },
        });
      }
    });
  }

  const shutdown = async () => { await Promise.all([closeBrowser(), closeDb(), shutdownAnalytics()]); process.exit(0); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT',  shutdown);
}

// ─── Entrada ──────────────────────────────────────────────────────────────────

const RUN_ONCE = process.argv[2] === '--run-once';
const KEY      = process.argv[3];

(async () => {
  const seasons = await resolveSeasonIds();
  if (RUN_ONCE && KEY) {
    await runOnce(KEY, seasons);
  } else {
    await startScheduled(seasons);
  }
})().catch(err => { log.error({ err }, 'Error fatal'); process.exit(1); });

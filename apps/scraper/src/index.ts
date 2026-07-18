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
const IDC_WSE_U17 = '320'; // Europeo Sub-17 M 2025/26 (World Skate Europe)

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
}

/** Resuelve temporada actual + fuente + timezone del Europeo desde DB. */
async function resolveWorldskate(): Promise<WorldskateCtx | null> {
  try {
    const res = await db.query<{ season_id: string; timezone: string | null; source_id: string }>(`
      SELECT s.id AS season_id, s.timezone, ds.id AS source_id
      FROM seasons s
      JOIN competitions c   ON c.id = s.competition_id
      JOIN data_sources ds  ON ds.scraper_key = 'worldskate_hockey'
      WHERE c.source_ref = 'wse_competition_320'
        AND s.is_current = TRUE
      LIMIT 1
    `);
    const row = res.rows[0];
    if (!row) { log.warn('World Skate: temporada actual no encontrada (¿seed ejecutado?)'); return null; }
    return { seasonId: row.season_id, sourceId: row.source_id, timezone: row.timezone };
  } catch (err) {
    log.error({ err }, 'Error resolviendo contexto World Skate');
    return null;
  }
}

async function runWorldskate(ctx: WorldskateCtx) {
  const scraper = new WorldskateScraper({
    idc: IDC_WSE_U17,
    seasonId: ctx.seasonId,
    sourceId: ctx.sourceId,
    timezone: ctx.timezone ?? undefined,
    competitionName: 'Europeo Sub-17 M',
  });
  const out = await scraper.run();

  const pipeline = new EtlPipeline({ sportSlug: 'hockey-patines', seasonId: ctx.seasonId });
  const mEtl = out.matches.success ? await pipeline.runMatches(out.matches) : { upserted: 0 };
  const sEtl = out.standings.success ? await pipeline.runStandings(out.standings) : { upserted: 0 };
  log.info(
    { matchesFound: out.matches.data.length, matchesUpserted: mEtl.upserted,
      standingsFound: out.standings.data.length, standingsUpserted: sEtl.upserted },
    'World Skate ETL: Europeo Sub-17'
  );
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
  // World Skate necesita su propio contexto (temporada/fuente/tz) resuelto en DB.
  if (key === 'worldskate_u17') {
    const ctx = await resolveWorldskate();
    if (!ctx) { log.error('World Skate: contexto no resuelto — ¿seed ejecutado?'); process.exit(1); }
    await runWorldskate(ctx);
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

  // World Skate Europe — solo si hay temporada actual sembrada (evita ruido offseason).
  const wse = await resolveWorldskate();
  if (wse) {
    crons.push({
      key: 'worldskate_u17',
      cron: process.env['CRON_WORLDSKATE'] ?? '*/5 * * * *',
      run: () => runWorldskate(wse),
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

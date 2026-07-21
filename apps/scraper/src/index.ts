/**
 * Punto de entrada del scraper — ejecución MANUAL de una tarea.
 *
 *   npm run start --workspace=apps/scraper -- --run-once <clave>
 *
 * Cada tarea hace scrape + ETL en un solo paso:
 *   1. El scraper recoge datos crudos de sidgad.es
 *   2. EtlPipeline transforma y persiste en PostgreSQL
 *
 * La ejecución PERIÓDICA en producción NO pasa por aquí: la lleva
 * deploy/etl-scheduler.sh dentro del contenedor `etl`. Este fichero tenía
 * además un planificador propio con node-cron que duplicaba ese trabajo, no
 * corría en ningún entorno y arrastraba vulnerabilidades; se eliminó (#37).
 *
 * Competiciones:
 *   idc=3150 — OK Liga Masculina
 *   idc=3481 — OK Liga Masculina Playoff (activo desde abril 2025)
 */
import { createLogger } from '@sports/logger';
import { db, closeDb } from '@sports/db';
// `analytics` sólo lo usaba el planificador eliminado; queda el cierre limpio.
import { shutdownAnalytics } from '@sports/analytics';
import { EtlPipeline } from '@sports/etl';
import { FepCalendarScraper }    from './scrapers/fep/fep-calendar.scraper.js';
import { FepStandingsScraper }   from './scrapers/fep/fep-standings.scraper.js';
import { FepMatchesScraper }     from './scrapers/fep/fep-matches.scraper.js';
import { FepCompetitionsScraper } from './scrapers/fep/fep-competitions.scraper.js';
import { FepListadoScraper }     from './scrapers/fep/fep-listado.scraper.js';
// La lógica de World Skate vive en su propio módulo porque la comparten este
// CLI (--run-once worldskate, vía etl-scheduler.sh) y el ciclo de 45 s de
// apps/etl/src/cron-live.ts. Ver el comentario de cabecera de ese fichero.
import { runAllWorldskate }      from './scrapers/worldskate/run-worldskate.js';
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

// ─── Definición de crons ──────────────────────────────────────────────────────


// ─── --run-once ───────────────────────────────────────────────────────────────

async function runOnce(key: string, seasons: SeasonLookup) {
  // World Skate: corre todas las competiciones activas (masc + fem + futuras).
  if (key === 'worldskate_u17' || key === 'worldskate') {
    await runAllWorldskate((seasonId) =>
      new EtlPipeline({ sportSlug: 'hockey-patines', seasonId, createRounds: true }));
    await Promise.all([closeBrowser(), closeDb(), shutdownAnalytics()]);
    return;
  }

  const map: Record<string, () => Promise<void>> = {
    // Datos estructurales (competiciones y listados). Estaba documentado en el
    // README pero NO existía en este mapa: sólo era alcanzable desde el cron
    // 'structural' del planificador, así que `--run-once fep_competitions`
    // fallaba con "Scraper no encontrado". Al eliminar el planificador se
    // recupera aquí, que es donde tenía que estar.
    fep_competitions: async () => {
      await new FepCompetitionsScraper().run();
      await new FepListadoScraper().run();
    },
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

// ─── Entrada ──────────────────────────────────────────────────────────────────

const RUN_ONCE = process.argv[2] === '--run-once';
const KEY      = process.argv[3];

const USO = `
Uso:  npm run start --workspace=apps/scraper -- --run-once <clave>

Claves disponibles:
  fep_competitions        catálogo de competiciones
  fep_calendar_ok_liga    calendario de OK Liga
  fep_standings_ok_liga   clasificación de OK Liga
  fep_calendar_playoff    calendario del playoff
  fep_standings_playoff   clasificación del playoff
  fep_matches_live        marcadores en vivo
  worldskate              World Skate Europe (todas las activas)

Este comando ejecuta UNA tarea y sale. La ejecución periódica en producción la
lleva deploy/etl-scheduler.sh dentro del contenedor 'etl'; aquí había un
segundo planificador con node-cron que duplicaba ese trabajo, no corría en
ningún sitio y arrastraba vulnerabilidades. Se eliminó (ver issue #37).
`;

(async () => {
  if (!RUN_ONCE || !KEY) {
    console.log(USO);
    process.exit(1);
  }
  const seasons = await resolveSeasonIds();
  await runOnce(KEY, seasons);
})().catch(err => { log.error({ err }, 'Error fatal'); process.exit(1); });

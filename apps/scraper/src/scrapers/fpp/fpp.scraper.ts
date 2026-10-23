/**
 * Scraper de una competición FPP: descarga sus secciones (calendario +
 * clasificación de cada id) y las convierte con `buildFppCompetition`.
 */
import type { ScrapeResult, ScrapedMatch, ScrapedRound, ScrapedStanding } from '@sports/shared-types';
import { createLogger } from '@sports/logger';
import type { FppCompetition } from './fpp-catalog.js';
import { fppGet, fppCalendarPath, fppStandingsPath } from './fpp-client.js';
import { parseFppCalendar, parseFppStandings } from './fpp.parser.js';
import { buildFppCompetition, type FppSectionData } from './fpp-structure.js';

const log = createLogger({ scraper: 'fpp_hockey' });
export const FPP_SCRAPER_KEY = 'fpp_hockey';

/** Descarga y parsea todas las secciones. Lanza si alguna falla (todo o nada). */
export async function fetchFppSections(comp: FppCompetition): Promise<FppSectionData[]> {
  const out: FppSectionData[] = [];
  for (const section of comp.sections) {
    const calendar = parseFppCalendar(await fppGet(fppCalendarPath(section.fppId)));
    const standings = section.hasStandings
      ? parseFppStandings(await fppGet(fppStandingsPath(section.fppId)))
      : [];
    if (calendar.length === 0) {
      // Una sección publicada sin filas suele ser un cambio de maquetación: mejor
      // fallar que borrar la jornada en silencio (el loader no corre si falla).
      throw new Error(`FPP ${section.fppId}: calendario sin filas (¿cambió la web?)`);
    }
    out.push({ section, calendar, standings });
  }
  return out;
}

export interface FppScrapeOutput {
  matches: ScrapeResult<ScrapedMatch>;
  standings: ScrapeResult<ScrapedStanding>;
  rounds: ScrapeResult<ScrapedRound>;
}

export async function scrapeFppCompetition(
  comp: FppCompetition,
  ctx: { seasonId: string; sourceId: string; timezone?: string | null },
): Promise<FppScrapeOutput> {
  const start = Date.now();
  const errors: Array<{ message: string; stack?: string }> = [];
  let built = { matches: [] as ScrapedMatch[], rounds: [] as ScrapedRound[], standings: [] as ScrapedStanding[], pendingTeams: 0 };
  try {
    const data = await fetchFppSections(comp);
    built = buildFppCompetition(comp, data, { ...ctx, now: new Date() });
    log.info(
      { competition: comp.name, matches: built.matches.length, standings: built.standings.length,
        rounds: built.rounds.length, pendingTeams: built.pendingTeams },
      'Scraping FPP completado',
    );
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    log.error({ err: e, competition: comp.name }, 'Error en scraper FPP');
    errors.push({ message: e.message, stack: e.stack });
  }
  const durationMs = Date.now() - start;
  const ok = errors.length === 0;
  const res = <T>(data: T[], entityType: string): ScrapeResult<T> =>
    ({ success: ok, data, errors, durationMs, scraperKey: FPP_SCRAPER_KEY, entityType });
  return {
    matches: res(built.matches, 'match'),
    standings: res(built.standings, 'standing'),
    rounds: res(built.rounds, 'round'),
  };
}

/**
 * Scraper de una competición vasca: divisiones → árbol (fases, jornadas,
 * partidos) → clasificación de cada fase de liga. Todo o nada: si una petición
 * falla, la competición no se carga (el loader no borra lo que había).
 */
import type { ScrapeResult, ScrapedMatch, ScrapedRound, ScrapedStanding } from '@sports/shared-types';
import { createLogger } from '@sports/logger';
import { FVP_SCRAPER_KEY, type FvpCompetition } from './fvp-catalog.js';
import { fvpGet, fvpPaths } from './fvp-client.js';
import { parseFvpTree, parseFvpStandings, type FvpRow } from './fvp.parser.js';
import { buildFvpCompetition, type FvpFaseStandings, type FvpBuilt } from './fvp-structure.js';

const log = createLogger({ scraper: FVP_SCRAPER_KEY });

export async function fetchFvpCompetition(apiId: string): Promise<{ rows: FvpRow[]; standings: FvpFaseStandings[] }> {
  const divisions = await fvpGet<Array<{ id: string }>>(fvpPaths.divisions(apiId));
  if (!Array.isArray(divisions) || divisions.length === 0) throw new Error(`FVP ${apiId}: competición sin divisiones`);
  const rows: FvpRow[] = [];
  const standings: FvpFaseStandings[] = [];
  for (const d of divisions) {
    const tree = await fvpGet<Array<{ id: string; nombre?: string; formato?: string }>>(fvpPaths.tree(d.id));
    rows.push(...parseFvpTree(tree));
    for (const f of tree) {
      if ((f.formato ?? 'LEAGUE').toUpperCase() !== 'LEAGUE') continue;
      standings.push({ faseId: f.id, faseNombre: f.nombre ?? '', rows: parseFvpStandings(await fvpGet(fvpPaths.standings(f.id))) });
    }
  }
  if (rows.length === 0) throw new Error(`FVP ${apiId}: calendario sin partidos (¿cambió la API?)`);
  return { rows, standings };
}

export interface FvpScrapeOutput {
  matches: ScrapeResult<ScrapedMatch>;
  standings: ScrapeResult<ScrapedStanding>;
  rounds: ScrapeResult<ScrapedRound>;
  unknownStates: string[];
}

export async function scrapeFvpCompetition(
  comp: FvpCompetition,
  ctx: { seasonId: string; sourceId: string; timezone?: string | null },
): Promise<FvpScrapeOutput> {
  const start = Date.now();
  const errors: Array<{ message: string; stack?: string }> = [];
  let built: FvpBuilt = { matches: [], rounds: [], standings: [], pendingTeams: 0, unknownStates: [] };
  try {
    const { rows, standings } = await fetchFvpCompetition(comp.apiId);
    built = buildFvpCompetition(comp, rows, standings, { ...ctx, now: new Date() });
    log.info({ competition: comp.name, matches: built.matches.length, standings: built.standings.length,
      rounds: built.rounds.length, pendingTeams: built.pendingTeams }, 'Scraping FVP completado');
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    log.error({ err: e, competition: comp.name }, 'Error en scraper FVP');
    errors.push({ message: e.message, stack: e.stack });
  }
  const durationMs = Date.now() - start;
  const ok = errors.length === 0;
  const res = <T>(data: T[], entityType: string): ScrapeResult<T> =>
    ({ success: ok, data, errors, durationMs, scraperKey: FVP_SCRAPER_KEY, entityType });
  return {
    matches: res(built.matches, 'match'),
    standings: res(built.standings, 'standing'),
    rounds: res(built.rounds, 'round'),
    unknownStates: built.unknownStates,
  };
}

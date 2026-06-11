import { upsertStanding, updateTeamLogoUrl, withTransaction, insertScrapeLog } from '@sports/db';
import type { ScrapedStanding, ScrapeResult } from '@sports/shared-types';
import { createLogger } from '@sports/logger';
import { RefResolver } from './ref-resolver.js';

const log = createLogger({ module: 'loader:standing' });

export interface LoadStandingsResult {
  upserted: number;
  skipped: number;
  errors: Array<{ item: string; error: string }>;
}

/**
 * Loader de clasificaciones.
 *
 * Las clasificaciones son una foto completa del momento del scraping.
 * Se procesan todas en una sola transaccion por temporada/grupo -- si falla
 * algún equipo, el grupo entero se revierte para evitar clasificaciones parciales.
 */
export async function loadStandings(
  scrapeResult: ScrapeResult<ScrapedStanding>,
  sportId: string,
  seasonId: string
): Promise<LoadStandingsResult> {
  const start = Date.now();
  const errors: Array<{ item: string; error: string }> = [];
  let upserted = 0;
  let skipped = 0;

  const resolver = new RefResolver(sportId);
  const items = scrapeResult.data;

  log.info({ total: items.length, seasonId }, 'Cargando clasificaciones');

  // Agrupar por group_name para transacciones por grupo
  const groups = new Map<string, typeof items>();
  for (const item of items) {
    const key = item.groupName ?? '_default';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }

  for (const [groupName, groupItems] of groups) {
    try {
      await withTransaction(async (client) => {
        for (const raw of groupItems) {
          const teamId = await resolver.resolveTeam(raw.teamRef);

          await upsertStanding({
            seasonId,
            teamId,
            groupName: raw.groupName,
            position: raw.position,
            played: raw.played,
            won: raw.won,
            drawn: raw.drawn,
            lost: raw.lost,
            goalsFor: raw.goalsFor,
            goalsAgainst: raw.goalsAgainst,
            points: raw.points,
            form: raw.form,
            sourceId: raw.sourceId,
            scrapedAt: raw.scrapedAt,
          }, client);

          // Persistir el logo scrapeado si viene en el standing
          if (raw.logoUrl) {
            await updateTeamLogoUrl(teamId, raw.logoUrl, client);
          }

          upserted++;
        }
      });

      log.debug({ group: groupName, count: groupItems.length }, 'Grupo de clasificacion cargado');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error({ group: groupName, err }, 'Error al cargar clasificacion de grupo');
      errors.push({ item: `grupo:${groupName}`, error: message });
      skipped += groupItems.length;
    }
  }

  const durationMs = Date.now() - start;

  await insertScrapeLog({
    scraperKey: scrapeResult.scraperKey,
    entityType: 'standing',
    status: errors.length === 0 ? 'success' : skipped === items.length ? 'error' : 'partial',
    recordsFound: items.length,
    recordsUpserted: upserted,
    errorMessage: errors.length > 0 ? errors.map((e) => e.error).join(' | ') : undefined,
    durationMs,
  });

  return { upserted, skipped, errors };
}

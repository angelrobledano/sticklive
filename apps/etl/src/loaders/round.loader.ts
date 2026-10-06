import { upsertRound } from '@sports/db';
import type { ScrapedRound, ScrapeResult } from '@sports/shared-types';
import { createLogger } from '@sports/logger';

const log = createLogger({ module: 'loader:round' });

export interface LoadRoundsResult {
  upserted: number;
  skipped: number;
  errors: Array<{ item: string; error: string }>;
}

/**
 * Loader de rondas/fases como estructura de datos (calendarios multi-fase,
 * p. ej. World Skate: grupos, cuartos, semis, final, colocación 5º-8º).
 *
 * Emite TODAS las rondas que trae la fuente AUNQUE no tengan partidos: las
 * eliminatorias cuyo cruce aún no publica la fuente existen como ronda y la
 * UI las muestra "por determinar". Idempotente por (season_id, number,
 * round_type) — el upsert conserva el nombre si el nuevo es NULL.
 */
export async function loadRounds(
  scrapeResult: ScrapeResult<ScrapedRound>
): Promise<LoadRoundsResult> {
  const start = Date.now();
  const errors: Array<{ item: string; error: string }> = [];
  let upserted = 0;
  let skipped = 0;

  const items = scrapeResult.data;
  log.info({ total: items.length }, 'Cargando rondas/estructura de fases');

  for (const raw of items) {
    if (!raw.seasonId || !raw.number) {
      skipped++;
      continue;
    }
    try {
      await upsertRound({
        seasonId: raw.seasonId,
        number: raw.number,
        name: raw.name,
        roundType: raw.roundType ?? 'regular',
        sourceId: raw.sourceId,
      });
      upserted++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ item: `${raw.seasonId}#${raw.number}`, error: message });
      log.warn({ err, seasonId: raw.seasonId, number: raw.number }, 'Ronda no cargada');
    }
  }

  const durationMs = Date.now() - start;
  log.info({ upserted, skipped, errors: errors.length, durationMs }, 'Rondas cargadas');
  return { upserted, skipped, errors };
}

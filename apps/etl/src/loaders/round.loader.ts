import { upsertRound, ensurePhase, ensurePhaseRound, pruneStaleRounds } from '@sports/db';
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
 * UI las muestra "por determinar". Idempotente por (season_id, phase_id,
 * number, round_type) — el upsert conserva el nombre si el nuevo es NULL.
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

  const phaseCache = new Map<string, string>();
  const seenBySeason = new Map<string, { phases: Set<string>; rounds: Set<string> }>();
  for (const raw of items) {
    if (!raw.seasonId || !raw.number) {
      skipped++;
      continue;
    }
    try {
      if (raw.phaseRef && raw.phaseKind) {
        // Ronda colgada de su FASE (072): la identidad es (temporada, fase, nº, tipo).
        const pKey = `${raw.seasonId}|${raw.phaseRef}`;
        let phaseId = phaseCache.get(pKey);
        if (!phaseId) {
          phaseId = await ensurePhase({
            seasonId: raw.seasonId,
            sourceRef: raw.phaseRef,
            kind: raw.phaseKind,
            isPlacement: raw.phaseIsPlacement ?? false,
            name: raw.phaseName ?? null,
            ordinal: raw.phaseOrdinal ?? 1,
            resolvedBy: raw.phaseResolvedBy ?? 'source_rounds',
            sourceId: raw.sourceId,
          });
          phaseCache.set(pKey, phaseId);
        }
        const roundId = await ensurePhaseRound({
          seasonId: raw.seasonId,
          phaseId,
          roundType: (raw.roundType ?? 'regular') === 'regular' ? 'regular' : 'playoff',
          number: raw.number,
          stage: raw.stage ?? null,
          name: raw.name ?? null,
          sourceId: raw.sourceId,
        });
        const seen = seenBySeason.get(raw.seasonId) ?? { phases: new Set<string>(), rounds: new Set<string>() };
        seen.phases.add(phaseId);
        seen.rounds.add(roundId);
        seenBySeason.set(raw.seasonId, seen);
      } else {
        await upsertRound({
          seasonId: raw.seasonId,
          number: raw.number,
          name: raw.name,
          roundType: raw.roundType ?? 'regular',
          sourceId: raw.sourceId,
        });
      }
      upserted++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ item: `${raw.seasonId}#${raw.number}`, error: message });
      log.warn({ err, seasonId: raw.seasonId, number: raw.number }, 'Ronda no cargada');
    }
  }

  // Estructura completa recibida sin errores: las rondas vacías que la fuente
  // ya no publica en esas fases se retiran (ver pruneStaleRounds).
  let pruned = 0;
  if (errors.length === 0 && scrapeResult.success) {
    for (const [seasonId, seen] of seenBySeason) {
      pruned += await pruneStaleRounds(seasonId, [...seen.phases], [...seen.rounds]);
    }
  }

  const durationMs = Date.now() - start;
  log.info({ upserted, skipped, pruned, errors: errors.length, durationMs }, 'Rondas cargadas');
  return { upserted, skipped, errors };
}

/**
 * Loader de partidos.
 *
 * Este es el loader más complejo porque necesita:
 * 1. Resolver homeTeamRef y awayTeamRef → UUIDs
 * 2. Manejar el caso en que los equipos aún no estén en DB
 * 3. Procesar en batches para no sobrecargar la DB
 * 4. Usar transacciones por batch (no por partido individual — más eficiente)
 */
import { upsertMatch, insertScrapeLog, db } from '@sports/db';
import type { ScrapedMatch, ScrapeResult } from '@sports/shared-types';
import { createLogger } from '@sports/logger';
import { transformMatch } from '../transformers/match.transformer.js';
import { RefResolver } from './ref-resolver.js';

const log = createLogger({ module: 'loader:match' });
const BATCH_SIZE = Number(process.env['ETL_BATCH_SIZE'] ?? 100);

export interface LoadMatchesResult {
  upserted: number;
  skipped: number;
  errors: Array<{ item: string; error: string }>;
}

export async function loadMatches(
  scrapeResult: ScrapeResult<ScrapedMatch>,
  sportId: string
): Promise<LoadMatchesResult> {
  const start = Date.now();
  const errors: Array<{ item: string; error: string }> = [];
  let upserted = 0;
  let skipped = 0;

  const resolver = new RefResolver(sportId);
  const items = scrapeResult.data;

  log.info({ total: items.length, batchSize: BATCH_SIZE }, 'Cargando partidos');

  // Procesar en batches (logging/control de flujo) pero cada upsert es independiente
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    log.debug({ batchStart: i, batchSize: batch.length }, 'Procesando batch');

    for (const raw of batch) {
      const itemLabel = `${raw.homeTeamRef} vs ${raw.awayTeamRef} (${raw.scheduledAt ?? 'sin fecha'})`;

      try {
        const { homeTeamRef, awayTeamRef, input, warnings } = transformMatch(raw);

        if (warnings.length > 0) {
          log.warn({ item: itemLabel, warnings }, 'Warnings en transformación de partido');
        }

        let resolved = false;
        try {
          // Resolver referencias de equipos
          const [homeTeamId, awayTeamId] = await Promise.all([
            resolver.resolveTeam(homeTeamRef),
            resolver.resolveTeam(awayTeamRef),
          ]);

          // Guardia anti-duplicados: el calendario del playoff lista cada
          // eliminatoria con filas placeholder sin idp (ref sintética, hora
          // 00:00). Si ya existe un partido REAL (con idp) del mismo cruce
          // en la misma fecha, no insertamos el sintético.
          if (input.sourceRef.startsWith('synthetic:') && input.scheduledAt) {
            // Placeholder con fecha pasada: si a estas alturas no tiene idp,
            // el partido no se jugó (o la fuente lo publicará como partido
            // real cuando ocurra). No insertamos fantasmas.
            const scheduled = new Date(input.scheduledAt).getTime();
            if (scheduled < Date.now() - 6 * 3_600_000) {
              log.debug({ item: itemLabel }, 'Placeholder sintético pasado omitido');
              skipped++;
              continue;
            }
            const dupe = await db.query(
              `SELECT id FROM matches
               WHERE season_id    = $1
                 AND home_team_id = $2
                 AND away_team_id = $3
                 AND scheduled_at::date = $4::date
                 AND source_ref NOT LIKE 'synthetic:%'
               LIMIT 1`,
              [input.seasonId, homeTeamId, awayTeamId, input.scheduledAt]
            );
            if ((dupe.rowCount ?? 0) > 0) {
              log.debug(
                { item: itemLabel },
                'Placeholder sintético omitido: ya existe el partido real'
              );
              skipped++;
              continue;
            }
          }

          await upsertMatch({ ...input, homeTeamId, awayTeamId });
          upserted++;
          resolved = true;
        } catch (teamErr) {
          // Equipo no encontrado — intentar UPDATE de score/status para partidos ya existentes
          // (el upsert completo falla si los equipos no estan en DB, pero el marcador si puede actualizarse)
          if (input.sourceRef) {
            const scoreResult = await db.query(
              `UPDATE matches
               SET home_score = COALESCE($2, home_score),
                   away_score = COALESCE($3, away_score),
                   status     = $4,
                   scraped_at = $5,
                   updated_at = NOW()
               WHERE source_ref = $1
               RETURNING id`,
              [
                input.sourceRef,
                input.homeScore ?? null,
                input.awayScore ?? null,
                input.status,
                input.scrapedAt,
              ]
            );
            if ((scoreResult.rowCount ?? 0) > 0) {
              log.debug(
                { sourceRef: input.sourceRef, score: { home: input.homeScore, away: input.awayScore }, status: input.status },
                'Score/status actualizados por ref (equipo no resolvible)'
              );
              upserted++;
              resolved = true;
            }
          }
          if (!resolved) {
            const msg = teamErr instanceof Error ? teamErr.message : String(teamErr);
            // Distinguir el caso ESPERADO (equipo no resoluble: competición no
            // indexada) del INESPERADO (fallo real del upsert, p. ej. un UUID
            // inválido en source_id). Antes ambos se enmascaraban con el mismo
            // mensaje engañoso y costaba diagnosticar (auditoría B2).
            if (msg.includes('No se encontró equipo')) {
              log.warn(
                { item: itemLabel, sourceRef: input.sourceRef },
                'Partido omitido: competición no indexada o equipos no registrados'
              );
            } else {
              log.error(
                { item: itemLabel, sourceRef: input.sourceRef, err: teamErr },
                'Partido omitido por error REAL al cargar (no es falta de equipo) — revisar'
              );
              errors.push({ item: itemLabel, error: msg });
            }
            skipped++;
            continue;
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error({ item: itemLabel, err }, 'Error al cargar partido');
        errors.push({ item: itemLabel, error: message });
        skipped++;
      }
    }
  }

  const durationMs = Date.now() - start;

  await insertScrapeLog({
    scraperKey: scrapeResult.scraperKey,
    entityType: 'match',
    status: errors.length === 0 ? 'success' : skipped === items.length ? 'error' : 'partial',
    recordsFound: items.length,
    recordsUpserted: upserted,
    errorMessage: errors.length > 0 ? `${errors.length} partidos fallaron` : undefined,
    durationMs,
  });

  log.info({ upserted, skipped, durationMs }, 'Carga de partidos completada');

  return { upserted, skipped, errors };
}

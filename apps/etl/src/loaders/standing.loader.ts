import { upsertStanding, updateTeamLogoUrl, withTransaction, insertScrapeLog, findTeamInSeasonByName, getSeasonSignals, type EntitySignals } from '@sports/db';
import type { ScrapedStanding, ScrapeResult } from '@sports/shared-types';
import { createLogger } from '@sports/logger';
import { RefResolver } from './ref-resolver.js';
import { isByeTeamName } from '../lib/bye-team.js';

const log = createLogger({ module: 'loader:standing' });

export interface LoadStandingsResult {
  upserted: number;
  skipped: number;
  errors: Array<{ item: string; error: string }>;
}

/**
 * Reintento ante deadlock (#316): durante 30 días hubo 736 errores 40P01
 * (14,3% de ejecuciones) al cargar standings. Causa: dos pipelines
 * concurrentes (el flock de /tmp no excluye entre contenedores, #317)
 * actualizando los mismos teams/standings en ORDEN DISTINTO. Mitigación en el
 * loader: reintentar el grupo con backoff; el orden determinista de abajo
 * reduce la probabilidad de que el retry vuelva a chocar.
 */
const DEADLOCK_SQLSTATE = '40P01';
const MAX_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [250, 750];

function isDeadlock(err: unknown): boolean {
  return (err as { code?: string })?.code === DEADLOCK_SQLSTATE;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  let byes = 0;

  const resolver = new RefResolver(sportId);
  const items = scrapeResult.data;

  log.info({ total: items.length, seasonId }, 'Cargando clasificaciones');

  // Señales de dominio (género/categoría) de la competición (#194): sin ellas
  // el resolver podía aceptar un equipo homónimo de OTRO género/categoría por
  // slug — fusión silenciosa. El loader de partidos ya las pasaba; standings no.
  const signals: EntitySignals = await getSeasonSignals(seasonId);

  // Agrupar por group_name para transacciones por grupo
  const groups = new Map<string, typeof items>();
  for (const item of items) {
    const key = item.groupName ?? '_default';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }

  for (const [groupName, groupItems] of groups) {
    try {
      // Resolución de equipos FUERA de la transacción y en orden determinista
      // por team_id (#316): dos procesos concurrentes que tocan los mismos
      // teams en distinto orden son la receta del deadlock; con el mismo orden,
      // el segundo espera en fila en vez de bloquearse mutuamente. Además saca
      // las queries de resolución fuera del lock de escritura.
      const resolved: Array<{ raw: ScrapedStanding; teamId: string }> = [];
      for (const raw of groupItems) {
        // "DESCANSO" no es un equipo: es el bye de las ligas impares. Si se
        // intenta resolver, el grupo entero falla y la tabla no se refresca.
        if (isByeTeamName(raw.teamRef)) {
          byes++;
          continue;
        }
        // Las clasificaciones traen solo el NOMBRE (sin ref): se busca primero
        // dentro de los equipos de ESTA temporada, así un filial nombrado igual
        // no cae en el primer equipo (que juega en otra liga). Si no aparece,
        // cascada normal del resolver (ahora con señales y fuente, #194).
        const teamId = (await findTeamInSeasonByName(seasonId, raw.teamRef))
          ?? await resolver.resolveTeam(raw.teamRef, raw.sourceId, signals);
        resolved.push({ raw, teamId });
      }
      resolved.sort((a, b) => a.teamId.localeCompare(b.teamId));

      let attempt = 0;
      for (;;) {
        attempt++;
        let attempted = 0;
        try {
          await withTransaction(async (client) => {
            for (const { raw, teamId } of resolved) {
              // La tabla trae la abreviatura del equipo (`.mobile`): rellena
              // `short_name` si está vacío (es lo que ve el usuario en listas).
              const abbr = (raw.abbreviation ?? '').trim();
              if (abbr) {
                await client
                  .query(
                    `UPDATE teams SET short_name = $2, updated_at = NOW()
                      WHERE id = $1 AND (short_name IS NULL OR short_name = '')`,
                    [teamId, abbr],
                  )
                  .catch(() => {});
              }

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

              attempted++;
            }
          });
          upserted += attempted;
          break;
        } catch (err) {
          // 40P01: la transacción se abortó entera — el grupo vuelve a empezar
          // desde cero (los UPDATE son idempotentes, re-ejecutar es seguro).
          if (isDeadlock(err) && attempt < MAX_ATTEMPTS) {
            const backoff = RETRY_BACKOFF_MS[Math.min(attempt - 1, RETRY_BACKOFF_MS.length - 1)] ?? 750;
            log.warn(
              { group: groupName, attempt, backoff },
              'Deadlock al cargar standings — reintentando grupo'
            );
            await sleep(backoff);
            continue;
          }
          throw err;
        }
      }

      log.debug({ group: groupName, count: groupItems.length }, 'Grupo de clasificacion cargado');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error({ group: groupName, err }, 'Error al cargar clasificacion de grupo');
      errors.push({ item: `grupo:${groupName}`, error: message });
      skipped += groupItems.length;
    }
  }

  const durationMs = Date.now() - start;
  log.info({ seasonId, upserted, skipped, byes, errors: errors.length, durationMs }, 'Clasificaciones cargadas');

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

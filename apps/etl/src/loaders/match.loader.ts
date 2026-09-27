/**
 * Loader de partidos.
 *
 * Este es el loader más complejo porque necesita:
 * 1. Resolver homeTeamRef y awayTeamRef → UUIDs
 * 2. Manejar el caso en que los equipos aún no estén en DB
 * 3. Procesar en batches para no sobrecargar la DB
 * 4. Usar transacciones por batch (no por partido individual — más eficiente)
 */
import { upsertMatch, insertScrapeLog, getSeasonSignals, upsertRound, db, learnSourceClub } from '@sports/db';
import type { ScrapedMatch, ScrapeResult } from '@sports/shared-types';
import { createLogger } from '@sports/logger';
import * as Sentry from '@sentry/node';
import { transformMatch } from '../transformers/match.transformer.js';
import { RefResolver } from './ref-resolver.js';
import { isStatusRegression } from '../status-regression.js';

const log = createLogger({ module: 'loader:match' });
const BATCH_SIZE = Number(process.env['ETL_BATCH_SIZE'] ?? 100);

export interface LoadMatchesResult {
  upserted: number;
  skipped: number;
  errors: Array<{ item: string; error: string }>;
}

export interface LoadMatchesOptions {
  /** Crear/asignar rondas desde roundRef+roundNumber (fuentes con fases). */
  createRounds?: boolean;
  /** Lote de importación (A4): se propaga a upsertMatch para los partidos
   *  nuevos, de modo que el re-scrape sea validable y promovible por lote. */
  importBatchId?: string;
  /** Enrich (A5): activa el upsert que reasigna season_id + etiqueta en el
   *  ON CONFLICT (recuperación de histórico). Por defecto false. */
  enrich?: boolean;
  /** Exigir que ambos equipos estén en `season_teams` de su temporada antes de
   *  INSERTAR un partido nuevo. Lo usa el feed GLOBAL de directo (#151): trae
   *  partidos de todas las competiciones con la temporada de fallback estampada,
   *  así que un alta sin esta guarda dejaría el partido para siempre en la
   *  competición equivocada. Si el partido ya existe por `source_ref`, se permite
   *  (solo se actualiza marcador/estado). */
  requireTeamsInSeason?: boolean;
  /** Sellar `started_at`/`finished_at` la primera vez que el partido se ve en
   *  estado `live`/`finished` (#189). Solo el flujo de directo: en el histórico
   *  la hora de scrape no es el instante real del partido. */
  stampLiveTimes?: boolean;
}

/**
 * Registra datos del partido del feed: refs de club (`fep_club_XX`) → equipo
 * ACOTADAS por competición (migración 054) y **abreviatura** del equipo
 * (`short_name`) cuando está vacía.
 *
 * La ref de club identifica al CLUB, no a la sección: un club puede tener primer
 * equipo y filial con el mismo nombre en ligas distintas (bug A/B del NOIA), así
 * que el mapa va acotado por competición (un club alinea un solo equipo por
 * competición). La abreviatura es la que da el propio feed (3 letras) y solo se
 * escribe si el equipo no tiene ya una.
 */
async function registrarDatosDeFeed(
  sourceId: string | undefined,
  seasonId: string,
  homeRef: string,
  homeTeamId: string | null,
  homeAbbr: string | null | undefined,
  awayRef: string,
  awayTeamId: string | null,
  awayAbbr: string | null | undefined,
): Promise<void> {
  const lados = [
    { ref: homeRef, teamId: homeTeamId, abbr: homeAbbr },
    { ref: awayRef, teamId: awayTeamId, abbr: awayAbbr },
  ].filter((l): l is { ref: string; teamId: string; abbr: string | null | undefined } => !!l.teamId);
  if (lados.length === 0) return;

  // Abreviatura: solo si falta (no pisa una ya puesta).
  for (const l of lados) {
    const abbr = (l.abbr ?? '').trim();
    if (!abbr) continue;
    await db
      .query(
        `UPDATE teams SET short_name = $2, updated_at = NOW()
          WHERE id = $1 AND (short_name IS NULL OR short_name = '')`,
        [l.teamId, abbr],
      )
      .catch(() => {});
  }

  // Mapa ref de club → equipo, acotado por competición.
  if (!sourceId) return;
  const clubs = lados.filter((l) => l.ref.startsWith('fep_club_'));
  if (clubs.length === 0) return;

  const season = await db.query<{ competition_id: string }>(
    `SELECT competition_id FROM seasons WHERE id = $1`, [seasonId],
  );
  const competitionId = season.rows[0]?.competition_id;
  if (!competitionId) return;

  for (const c of clubs) {
    await learnSourceClub(sourceId, competitionId, c.ref, c.teamId).catch(() => {});
  }
}

export async function loadMatches(
  scrapeResult: ScrapeResult<ScrapedMatch>,
  sportId: string,
  options: LoadMatchesOptions = {}
): Promise<LoadMatchesResult> {
  const start = Date.now();
  const errors: Array<{ item: string; error: string }> = [];
  let upserted = 0;
  let skipped = 0;

  const resolver = new RefResolver(sportId);
  const items = scrapeResult.data;

  // Caché de rondas resueltas en esta ejecución: "season|number|type" → roundId.
  const roundCache = new Map<string, string>();
  async function resolveRound(raw: ScrapedMatch): Promise<string | undefined> {
    if (!options.createRounds || raw.roundNumber == null || !raw.seasonId) return undefined;
    const roundType = raw.roundType ?? 'regular';
    const key = `${raw.seasonId}|${raw.roundNumber}|${roundType}`;
    const cached = roundCache.get(key);
    if (cached) return cached;
    const id = await upsertRound({
      seasonId: raw.seasonId,
      number: raw.roundNumber,
      name: raw.roundRef,
      roundType,
      sourceId: raw.sourceId,
    });
    roundCache.set(key, id);
    return id;
  }

  // Señales de dominio por temporada (género/categoría de la competición), para
  // la auto-confirmación del resolver (Fase 3). Cacheado por ejecución.
  const signalsCache = new Map<string, { gender: string | null; ageCategory: string | null }>();
  async function signalsFor(
    seasonId: string | undefined,
  ): Promise<{ gender: string | null; ageCategory: string | null } | undefined> {
    if (!seasonId) return undefined;
    const cached = signalsCache.get(seasonId);
    if (cached) return cached;
    const s = await getSeasonSignals(seasonId);
    signalsCache.set(seasonId, s);
    return s;
  }

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

        // Ronda/fase (solo si la fuente emite estructura y el flag está activo)
        const roundId = await resolveRound(raw);
        if (roundId) input.roundId = roundId;

        let resolved = false;
        try {
          // Resolver referencias de equipos (con señales de dominio de la
          // temporada para la auto-confirmación del escalón 3, Fase 3).
          const signals = await signalsFor(input.seasonId);
          const [homeTeamId, awayTeamId] = await Promise.all([
            resolver.resolveTeam(homeTeamRef, raw.sourceId, signals),
            resolver.resolveTeam(awayTeamRef, raw.sourceId, signals),
          ]);

          // ADOPCIÓN de placeholders sintéticos: algunas fuentes (World Skate)
          // no publican el id del partido (idp) hasta que se juega, así que el
          // partido se guarda antes con ref sintética. Cuando aparece el idp la
          // ref cambia y, sin esto, se insertaría un DUPLICADO dejando el
          // fantasma programado. Adoptamos la fila existente reescribiendo su
          // source_ref: el partido conserva su id, historial y favoritos.
          if (!input.sourceRef.startsWith('synthetic:') && input.scheduledAt) {
            const adopted = await db.query(
              `UPDATE matches SET source_ref = $1, updated_at = NOW()
               WHERE id = (
                 SELECT id FROM matches
                 WHERE season_id    = $2
                   AND home_team_id = $3
                   AND away_team_id = $4
                   AND scheduled_at::date = $5::date
                   AND source_ref LIKE 'synthetic:%'
                 LIMIT 1
               )
               AND NOT EXISTS (SELECT 1 FROM matches WHERE source_ref = $1)`,
              [input.sourceRef, input.seasonId, homeTeamId, awayTeamId, input.scheduledAt]
            );
            if ((adopted.rowCount ?? 0) > 0) {
              log.info(
                { item: itemLabel, sourceRef: input.sourceRef },
                'Placeholder sintético adoptado por el partido real (sin duplicado)'
              );
            }
          }

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

          // Guarda del feed GLOBAL de directo (#151): `rfep_mc_1.php` trae
          // partidos de TODAS las competiciones y el scraper les estampa la
          // temporada de fallback. Si los equipos no pertenecen a ESA temporada,
          // insertar el partido lo dejaría para siempre en la competición
          // equivocada. Se omite el alta; si ya existe por `source_ref`, el
          // upsert de abajo solo actualiza marcador/estado.
          if (options.requireTeamsInSeason) {
            const member = await db.query<{ ok: boolean }>(
              `SELECT (EXISTS(SELECT 1 FROM season_teams WHERE season_id = $1 AND team_id = $2)
                       AND EXISTS(SELECT 1 FROM season_teams WHERE season_id = $1 AND team_id = $3)) AS ok`,
              [input.seasonId, homeTeamId, awayTeamId]
            );
            if (!member.rows[0]?.ok) {
              const yaExiste = await db.query(
                `SELECT 1 FROM matches WHERE source_ref = $1 LIMIT 1`, [input.sourceRef]
              );
              if ((yaExiste.rowCount ?? 0) === 0) {
                log.warn(
                  { item: itemLabel, seasonId: input.seasonId },
                  'Partido omitido: sus equipos no pertenecen a la temporada del feed global (no se inserta en la competición equivocada)'
                );
                skipped++;
                continue;
              }
            }
          }

          // #189: sella el instante de inicio/fin la PRIMERA vez que el partido
          // se ve en ese estado. El upsert usa COALESCE(matches.x, EXCLUDED.x)
          // para que los re-scrapes no lo pisen.
          if (options.stampLiveTimes) {
            const at = raw.scrapedAt ?? new Date();
            if (input.status === 'live' && !input.startedAt) input.startedAt = at;
            if (input.status === 'finished' && !input.finishedAt) input.finishedAt = at;
          }

          // #188: observabilidad de regresiones de estado (finished/live →
          // scheduled). No se bloquea la transición (una corrección de la fuente
          // es legítima), solo se deja rastro en logs y Sentry.
          const prevRow = await db.query<{ status: string }>(
            `SELECT status FROM matches WHERE source_ref = $1 LIMIT 1`, [input.sourceRef]
          );
          const prevStatus = prevRow.rows[0]?.status ?? null;
          if (isStatusRegression(prevStatus, input.status)) {
            log.warn(
              { item: itemLabel, sourceRef: input.sourceRef, from: prevStatus, to: input.status },
              'Regresión de estado de partido (posible glitch o corrección de la fuente)'
            );
            Sentry.captureMessage('Regresión de estado de partido', {
              level: 'warning',
              extra: { sourceRef: input.sourceRef, from: prevStatus, to: input.status, seasonId: input.seasonId },
            });
          }

          await upsertMatch({ ...input, homeTeamId, awayTeamId, importBatchId: options.importBatchId, enrich: options.enrich });
          upserted++;
          resolved = true;
        } catch (teamErr) {
          // Equipo no encontrado — intentar UPDATE de score/status para partidos ya existentes
          // (el upsert completo falla si los equipos no estan en DB, pero el marcador si puede actualizarse)
          if (input.sourceRef) {
            const byRef = await db.query<{
              id: string; season_id: string; home_team_id: string; away_team_id: string;
            }>(
              `UPDATE matches
               SET home_score = COALESCE($2, home_score),
                   away_score = COALESCE($3, away_score),
                   status     = $4,
                   scraped_at = $5,
                   updated_at = NOW()
               WHERE source_ref = $1
               RETURNING id, season_id, home_team_id, away_team_id`,
              [
                input.sourceRef,
                input.homeScore ?? null,
                input.awayScore ?? null,
                input.status,
                input.scrapedAt,
              ]
            );
            const hit = byRef.rows[0];
            if (hit) {
              log.debug(
                { sourceRef: input.sourceRef, score: { home: input.homeScore, away: input.awayScore }, status: input.status },
                'Score/status actualizados por ref (equipo no resolvible)'
              );
              upserted++;
              resolved = true;
              await registrarDatosDeFeed(raw.sourceId, hit.season_id, homeTeamRef, hit.home_team_id, raw.homeTeamAbbr, awayTeamRef, hit.away_team_id, raw.awayTeamAbbr);
            }
          }
          // Feed de directo con refs de CLUB (`fep_club_XX`), que no resuelven:
          // si el partido ya existe con la ref del feed, el UPDATE de arriba basta;
          // si no (nuestro partido es un placeholder `synthetic:` porque el
          // calendario aún no publica el idp), se ADOPTA por COMPETICIÓN + FECHA.
          //
          // Desempate: si esa competición tiene VARIOS partidos a esa misma hora, se
          // usa el mapa `source_club_map` (ref de club → equipo, acotado por
          // competición, migración 054) para elegir el candidato cuyos equipos son
          // los del feed. Sin candidato inequívoco no se toca nada.
          if (
            !resolved &&
            input.sourceRef &&
            !input.sourceRef.startsWith('synthetic:') &&
            input.scheduledAt &&
            raw.competitionName &&
            raw.sourceId
          ) {
            const adopted = await db.query<{
              id: string; season_id: string; home_team_id: string; away_team_id: string;
            }>(
              `WITH cand AS (
                 SELECT m.id, m.home_team_id, m.away_team_id
                   FROM matches m
                   JOIN seasons s ON s.id = m.season_id AND s.is_current
                   JOIN competitions c ON c.id = s.competition_id
                  WHERE m.source_ref LIKE 'synthetic:%'
                    AND m.scheduled_at = $2
                    AND lower(c.name) = lower($3)
               ), mapa AS (
                 SELECT scm.club_ref, scm.team_id
                   FROM source_club_map scm
                   JOIN competitions c2 ON c2.id = scm.competition_id
                  WHERE scm.source_id = $4 AND lower(c2.name) = lower($3)
                    AND scm.club_ref IN ($5, $6)
               ), elegido AS (
                 SELECT cand.id
                   FROM cand
                  WHERE (SELECT count(*) FROM cand) = 1
                     OR (cand.home_team_id = (SELECT team_id FROM mapa WHERE club_ref = $5)
                         AND cand.away_team_id = (SELECT team_id FROM mapa WHERE club_ref = $6))
                  LIMIT 1
               )
               UPDATE matches
                  SET source_ref = $1, updated_at = NOW()
                WHERE id = (SELECT id FROM elegido)
                  AND NOT EXISTS (SELECT 1 FROM matches WHERE source_ref = $1)
               RETURNING id, season_id, home_team_id, away_team_id`,
              [input.sourceRef, input.scheduledAt, raw.competitionName, raw.sourceId, homeTeamRef, awayTeamRef],
            );
            const adoptedHit = adopted.rows[0];
            if (adoptedHit) {
              await db.query(
                `UPDATE matches
                    SET home_score = COALESCE($2, home_score),
                        away_score = COALESCE($3, away_score),
                        status     = $4,
                        scraped_at = $5,
                        updated_at = NOW()
                  WHERE id = $1`,
                [adoptedHit.id, input.homeScore ?? null, input.awayScore ?? null, input.status, input.scrapedAt],
              );
              log.info(
                { sourceRef: input.sourceRef, competition: raw.competitionName, scheduledAt: input.scheduledAt },
                'Placeholder sintético adoptado por competición+fecha (feed de directo)'
              );
              resolved = true;
              upserted++;
              await registrarDatosDeFeed(raw.sourceId, adoptedHit.season_id, homeTeamRef, adoptedHit.home_team_id, raw.homeTeamAbbr, awayTeamRef, adoptedHit.away_team_id, raw.awayTeamAbbr);
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

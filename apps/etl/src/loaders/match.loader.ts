/**
 * Loader de partidos.
 *
 * Este es el loader más complejo porque necesita:
 * 1. Resolver homeTeamRef y awayTeamRef → UUIDs
 * 2. Manejar el caso en que los equipos aún no estén en DB
 * 3. Procesar en batches para no sobrecargar la DB
 * 4. Usar transacciones por batch (no por partido individual — más eficiente)
 */
import { isClubRef } from '../../../scraper/src/core/sources.js';
import { upsertMatch, insertScrapeLog, getSeasonSignals, upsertRound, db, learnSourceClub, ensurePhase, ensurePhaseRound } from '@sports/db';
import type { ScrapedMatch, ScrapeResult } from '@sports/shared-types';
import { resolveStatusTransition } from '@sports/shared-types';
import { createLogger } from '@sports/logger';
import * as Sentry from '@sentry/node';
import { transformMatch } from '../transformers/match.transformer.js';
import { RefResolver } from './ref-resolver.js';
import { buildMatchErrorMessage, type MatchLoadError } from './match-error-message.js';
import { keepPastSynthetic } from './synthetic-policy.js';
import { isStatusRegression } from '../status-regression.js';
import { resolveLiveTimeStamps } from '../live-times.js';

const log = createLogger({ module: 'loader:match' });
const BATCH_SIZE = Number(process.env['ETL_BATCH_SIZE'] ?? 100);

export interface LoadMatchesResult {
  upserted: number;
  skipped: number;
  errors: MatchLoadError[];
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
  /** Guarda anti-cruce (#229): rechazar ALTAS con scheduled_at fuera de la
   *  ventana de su temporada [start−45d, end+45d]. Por defecto ACTIVA (false =
   *  desactivar; el enrich y las herramientas de reparación pueden necesitar
   *  saltarla — también hay kill-switch ETL_SEASON_WINDOW_GUARD=off). Solo
   *  aplica a temporadas con fechas completas. */
  enforceSeasonWindow?: boolean;
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
  const clubs = lados.filter((l) => isClubRef(l.ref));
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
  const errors: MatchLoadError[] = [];
  let upserted = 0;
  let skipped = 0;

  const resolver = new RefResolver(sportId);
  const items = scrapeResult.data;

  // Caché de fases/rondas resueltas en esta ejecución.
  const phaseCache = new Map<string, string>();
  const roundCache = new Map<string, string>();
  /**
   * Ronda (y fase) de un partido cuando la FUENTE emite estructura y el flag
   * está activo (World Skate). Con fase explícita (`phaseRef`) la ronda cuelga
   * de su fase (072); sin ella, camino legado por (temporada, número, tipo).
   */
  async function resolveRound(raw: ScrapedMatch): Promise<{ roundId: string; phaseId?: string } | undefined> {
    if (!options.createRounds || raw.roundNumber == null || !raw.seasonId) return undefined;
    const roundType = raw.roundType ?? 'regular';
    let phaseId: string | undefined;
    if (raw.phaseRef && raw.phaseKind) {
      const pKey = `${raw.seasonId}|${raw.phaseRef}`;
      phaseId = phaseCache.get(pKey);
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
    }
    const key = `${raw.seasonId}|${phaseId ?? '-'}|${raw.roundNumber}|${roundType}`;
    const cached = roundCache.get(key);
    if (cached) return { roundId: cached, phaseId };
    const roundId = phaseId
      ? await ensurePhaseRound({
          seasonId: raw.seasonId,
          phaseId,
          roundType: roundType === 'regular' ? 'regular' : 'playoff',
          number: raw.roundNumber,
          stage: raw.stage ?? null,
          name: raw.roundRef ?? null,
          sourceId: raw.sourceId,
        })
      : await upsertRound({
          seasonId: raw.seasonId,
          number: raw.roundNumber,
          name: raw.roundRef,
          roundType,
          sourceId: raw.sourceId,
        });
    roundCache.set(key, roundId);
    return { roundId, phaseId };
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

  // Ventana de fechas por temporada (#229), cacheada por ejecución. NULL =
  // temporada sin fechas completas (p. ej. 'Histórico'): no se puede guardar,
  // se deja pasar (el enrich ya movió esos partidos; aquí no hay señal).
  const MARGEN_VENTANA_MS = 45 * 24 * 3_600_000; // 45 días: copas/ajustes de calendario
  const windowCache = new Map<string, { start: number; end: number } | null>();
  async function seasonWindow(seasonId: string | undefined): Promise<{ start: number; end: number } | null | undefined> {
    if (!seasonId) return undefined;
    if (windowCache.has(seasonId)) return windowCache.get(seasonId);
    const { rows } = await db.query<{ start_date: string | null; end_date: string | null }>(
      `SELECT start_date::text AS start_date, end_date::text AS end_date FROM seasons WHERE id = $1`,
      [seasonId]
    );
    const r = rows[0];
    const v = r?.start_date && r?.end_date
      ? { start: new Date(r.start_date).getTime(), end: new Date(r.end_date).getTime() }
      : null;
    windowCache.set(seasonId, v);
    return v;
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
        const resolvedRound = await resolveRound(raw);
        if (resolvedRound) {
          input.roundId = resolvedRound.roundId;
          if (resolvedRound.phaseId) input.phaseId = resolvedRound.phaseId;
        }

        let resolved = false;
        try {
          // Resolver referencias de equipos (con señales de dominio de la
          // temporada para la auto-confirmación del escalón 3, Fase 3).
          const signals = await signalsFor(input.seasonId);
          const [homeTeamId, awayTeamId] = await Promise.all([
            resolver.resolveTeam(homeTeamRef, raw.sourceId, signals, input.seasonId),
            resolver.resolveTeam(awayTeamRef, raw.sourceId, signals, input.seasonId),
          ]);

          // Escudo del calendario: rellena `teams.logo_url` si está vacío (la
          // fuente sirve el logo del CDN). Solo si falta, para no pisar uno ya
          // bueno; resolver el equipo no lo persiste.
          for (const l of [
            { id: homeTeamId, url: raw.homeTeamLogoUrl },
            { id: awayTeamId, url: raw.awayTeamLogoUrl },
          ]) {
            const url = (l.url ?? '').trim();
            if (!url) continue;
            await db
              .query(
                `UPDATE teams SET logo_url = $2, updated_at = NOW()
                  WHERE id = $1 AND (logo_url IS NULL OR logo_url = '')`,
                [l.id, url],
              )
              .catch(() => {});
          }

          // ADOPCIÓN de placeholders sintéticos: algunas fuentes (World Skate)
          // no publican el id del partido (idp) hasta que se juega, así que el
          // partido se guarda antes con ref sintética. Cuando aparece el idp la
          // ref cambia y, sin esto, se insertaría un DUPLICADO dejando el
          // fantasma programado. Adoptamos la fila existente reescribiendo su
          // source_ref: el partido conserva su id, historial y favoritos.
          // Adopción también de placeholders SIN fecha (scheduled_at NULL): son
          // los "nodate" del calendario de copas/supercopas. Sin esto, el
          // partido real se insertaba aparte y el fantasma quedaba duplicado.
          if (!input.sourceRef.startsWith('synthetic:') && input.scheduledAt) {
            const adopted = await db.query(
              `UPDATE matches SET source_ref = $1, updated_at = NOW()
               WHERE id = (
                 SELECT id FROM matches
                 WHERE season_id    = $2
                   AND home_team_id = $3
                   AND away_team_id = $4
                   AND source_ref LIKE 'synthetic:%'
                   AND ($5::timestamptz IS NULL OR scheduled_at IS NULL OR scheduled_at::date = $5::date)
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

          // Guardia anti-duplicados: el calendario lista cada cruce con filas
          // placeholder sin idp (ref sintética). Si ya existe un partido REAL
          // del mismo cruce, no insertamos el sintético.
          if (input.sourceRef.startsWith('synthetic:')) {
            // Placeholder con fecha pasada: si a estas alturas no tiene idp, el
            // partido no se jugó. Solo aplica cuando tiene fecha.
            if (input.scheduledAt) {
              const scheduled = new Date(input.scheduledAt).getTime();
              if (scheduled < Date.now() - 6 * 3_600_000) {
                // En eliminatorias el cruce es real aunque la fuente aún no
                // publique acta (final sin idp): se conserva para el cuadro.
                const roundType = input.roundId
                  ? (await db.query<{ round_type: string }>(
                      `SELECT round_type FROM rounds WHERE id = $1`,
                      [input.roundId],
                    )).rows[0]?.round_type ?? null
                  : null;
                const hasResult = input.homeScore != null && input.awayScore != null;
                if (!keepPastSynthetic(roundType, hasResult)) {
                  log.debug({ item: itemLabel }, 'Placeholder sintético pasado omitido');
                  skipped++;
                  continue;
                }
              }
            }
            // Con fecha: el mismo día. Sin fecha ("nodate"): solo si hay un
            // único partido real del cruce (con dos mangas no se toca).
            const dupe = await db.query(
              `SELECT 1 FROM matches r
               WHERE r.season_id    = $1
                 AND r.home_team_id = $2
                 AND r.away_team_id = $3
                 AND r.source_ref NOT LIKE 'synthetic:%'
                 AND (
                   -- Con fecha: el mismo cruce el mismo día.
                   ($4::timestamptz IS NOT NULL AND (r.scheduled_at IS NULL OR r.scheduled_at::date = $4::date))
                   -- Sin fecha ("nodate"): solo si hay UN único partido real del cruce.
                   OR ($4::timestamptz IS NULL AND (
                         SELECT count(*) FROM matches r2
                          WHERE r2.season_id = $1 AND r2.home_team_id = $2 AND r2.away_team_id = $3
                            AND r2.source_ref NOT LIKE 'synthetic:%') = 1)
                 )
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
          if (options.stampLiveTimes && input.status) {
            const at = raw.scrapedAt ?? new Date();
            // #189 + #377(P3-11): sella inicio/fin la primera vez. En `finished`
            // sin inicio conocido se usa `scheduled_at` para no dejar NULL.
            const stamps = resolveLiveTimeStamps(input.status, input.scheduledAt, at);
            if (stamps.startedAt && !input.startedAt) input.startedAt = stamps.startedAt;
            if (stamps.finishedAt && !input.finishedAt) input.finishedAt = stamps.finishedAt;
          }

          // #188: observabilidad de regresiones de estado (finished/live →
          // scheduled). No se bloquea la transición (una corrección de la fuente
          // es legítima), solo se deja rastro en logs y Sentry.
          const prevRow = await db.query<{ status: string }>(
            `SELECT status FROM matches WHERE source_ref = $1 LIMIT 1`, [input.sourceRef]
          );
          const prevStatus = prevRow.rows[0]?.status ?? null;
          // Única regla de transición (@sports/shared-types): sin observación de
          // estado se conserva el actual; con observación, se aplica.
          const transition = resolveStatusTransition(prevStatus, input.status);
          if (input.status !== undefined) input.status = transition.status;
          if (isStatusRegression(prevStatus, input.status)) {
            // El from/to y la ref VAN EN EL MENSAJE: los extras de Sentry no se
            // ven desde la API de búsqueda y los logs de docker rotan — con la
            // ventana de directo WSG (7/10) los 114 eventos eran inanalizables.
            const detalle = `Regresión de estado de partido: ${prevStatus ?? 'null'} → ${input.status} [${input.sourceRef}] (posible glitch o corrección de la fuente)`;
            log.warn({ item: itemLabel, sourceRef: input.sourceRef, from: prevStatus, to: input.status }, detalle);
            Sentry.captureMessage(detalle, {
              level: 'warning',
              fingerprint: ['status-regression', input.sourceRef],
              extra: { sourceRef: input.sourceRef, from: prevStatus, to: input.status, seasonId: input.seasonId },
            });
          }

          // GUARDA ANTI-CRUCE (#229): un alta con scheduled_at fuera de la
          // ventana de su temporada [start−45d, end+45d] fabrica exactamente los
          // partidos "colgando de la temporada equivocada" (4 de sep-2026 en la
          // 2025/26, #328/#206). Para ALTAS se rechaza (explícito, con Sentry);
          // para partidos YA EXISTENTES solo se avisa: su marcador/estado es
          // válido y el cambio de temporada lo lleva el enrich, no el loader.
          // Kill-switch de emergencia: ETL_SEASON_WINDOW_GUARD=off.
          if (options.enforceSeasonWindow !== false && process.env['ETL_SEASON_WINDOW_GUARD'] !== 'off' && input.scheduledAt) {
            const ventana = await seasonWindow(input.seasonId);
            if (ventana) {
              const t = input.scheduledAt.getTime();
              const fuera = t < ventana.start - MARGEN_VENTANA_MS || t > ventana.end + MARGEN_VENTANA_MS;
              if (fuera && prevRow.rows.length === 0) {
                log.error(
                  {
                    item: itemLabel, sourceRef: input.sourceRef, seasonId: input.seasonId,
                    scheduledAt: input.scheduledAt.toISOString(),
                    ventana: { desde: new Date(ventana.start).toISOString(), hasta: new Date(ventana.end).toISOString() },
                  },
                  'Partido NUEVO con fecha fuera de la ventana de su temporada — rechazado (#229). ¿Temporada equivocada en el feed o fechas de temporada desajustadas?'
                );
                Sentry.captureMessage('Alta de partido fuera de la ventana de temporada', {
                  level: 'warning',
                  extra: { sourceRef: input.sourceRef, seasonId: input.seasonId, scheduledAt: input.scheduledAt.toISOString() },
                });
                skipped++;
                continue;
              }
              if (fuera) {
                log.warn(
                  { item: itemLabel, sourceRef: input.sourceRef, seasonId: input.seasonId, scheduledAt: input.scheduledAt.toISOString() },
                  'Partido existente con fecha fuera de la ventana de su temporada — se actualiza marcador/estado pero conviene revisar su temporada (#229/#328)'
                );
              }
            }
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
                   -- Coherencia del ganador (#326): mismo trato que en
                   -- upsertMatch — un marcador que pasa a empate sin tanda
                   -- invalida el win_type/winner derivado anterior.
                   win_type = CASE
                     WHEN COALESCE($2, home_score) IS NOT NULL
                      AND COALESCE($2, home_score) = COALESCE($3, away_score)
                      AND win_type IS DISTINCT FROM 'penalties'
                     THEN NULL ELSE win_type END,
                   winner_team_id = CASE
                     WHEN COALESCE($2, home_score) IS NOT NULL
                      AND COALESCE($2, home_score) = COALESCE($3, away_score)
                      AND win_type IS DISTINCT FROM 'penalties'
                     THEN NULL ELSE winner_team_id END,
                   status     = COALESCE($4, status),
                   scraped_at = $5,
                   updated_at = NOW()
               WHERE source_ref = $1
               RETURNING id, season_id, home_team_id, away_team_id`,
              [
                input.sourceRef,
                input.homeScore ?? null,
                input.awayScore ?? null,
                input.status ?? null,
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
                        -- Coherencia del ganador (#326): ver upsertMatch.
                        win_type = CASE
                          WHEN COALESCE($2, home_score) IS NOT NULL
                           AND COALESCE($2, home_score) = COALESCE($3, away_score)
                           AND win_type IS DISTINCT FROM 'penalties'
                          THEN NULL ELSE win_type END,
                        winner_team_id = CASE
                          WHEN COALESCE($2, home_score) IS NOT NULL
                           AND COALESCE($2, home_score) = COALESCE($3, away_score)
                           AND win_type IS DISTINCT FROM 'penalties'
                          THEN NULL ELSE winner_team_id END,
                        status     = COALESCE($4, status),
                        scraped_at = $5,
                        updated_at = NOW()
                  WHERE id = $1`,
                [adoptedHit.id, input.homeScore ?? null, input.awayScore ?? null, input.status ?? null, input.scrapedAt],
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
              errors.push({ item: itemLabel, sourceRef: input.sourceRef, error: msg });
            }
            skipped++;
            continue;
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error({ item: itemLabel, err }, 'Error al cargar partido');
        errors.push({ item: itemLabel, sourceRef: raw.sourceRef, error: message });
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
    errorMessage: buildMatchErrorMessage(errors),
    durationMs,
  });

  log.info({ upserted, skipped, durationMs }, 'Carga de partidos completada');

  return { upserted, skipped, errors };
}

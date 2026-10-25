/**
 * Resolución de referencias externas → UUIDs internos.
 *
 * La fuente de datos usa sus propios IDs (source_ref) o simplemente nombres.
 * El ETL necesita convertirlos a los UUIDs de nuestra DB antes de insertar.
 *
 * Estrategia por entidad:
 *   1. Buscar por source_ref exacto (el más fiable)
 *   2. Si no hay match, buscar por slug (nombre normalizado)
 *   3. Si no hay match por slug, buscar por similitud de nombre (pg_trgm)
 *   4. Si nada funciona → lanzar error para que el pipeline lo registre
 *
 * El resolver mantiene una caché en memoria por ejecución para evitar
 * N queries a la DB para el mismo equipo en batches grandes.
 */
import {
  findTeamsBySourceRef,
  findTeamById,
  findTeamBySlug,
  resolveTeamViaSourceMap,
  upsertSourceEntityMapTeam,
  findTeamByNormalizedAlias,
  findSimilarTeamNames,
  enqueueResolution,
  autoConfirmTeam,
  upsertTeamAlias,
  findCompetitionBySourceRef,
  findCompetitionBySlug,
  findSeasonBySourceRef,
  findTeamIdBySeasonRef,
  recordSeasonTeamRef,
  type DbTeam,
} from '@sports/db';
import { createLogger } from '@sports/logger';
import { slugify } from '../transformers/slugify.js';
import { normalizeTeamName } from '../transformers/normalize.js';
import { isClubRef } from '../../../scraper/src/core/sources.js';
import { collapseRepeatedTeamLetter } from '../../../scraper/src/core/team-name.js';

const log = createLogger({ module: 'ref-resolver' });

/**
 * ¿Contradice el equipo las señales de la competición? (#194)
 *
 * Sólo se considera conflicto cuando AMBOS lados conocen el dato (NULL en la
 * BD = legado sin clasificar: no bloquea). El género y la categoría son más
 * discriminantes que el nombre: son lo que separa al filial del primer equipo
 * y al equipo femenino del masculino.
 */
export function signalsConflict(
  team: DbTeam,
  signals?: { gender?: string | null; ageCategory?: string | null },
): boolean {
  if (!signals) return false;
  if (team.gender && signals.gender && team.gender !== signals.gender) return true;
  if (team.age_category && signals.ageCategory && team.age_category !== signals.ageCategory) return true;
  return false;
}

/**
 * #228: elige el equipo cuando la ref casa con N candidatos.
 *   · 0 → ninguno;  · 1 → ese;  · >1 → AMBIGUO.
 *
 * El puente `source_ref`/`alt_source_refs` es GLOBAL (sin namespacing por portal
 * sidgad), así que una misma ref puede designar 2-3 equipos distintos. Resolver
 * "la primera" acierta o falla a ciegas; en ambiguo NO se resuelve por ref y se
 * sigue la cascada (slug/alias/fuzzy/HITL). Pura y testeable sin navegador.
 */
export function pickUnambiguousTeam<T>(
  rows: readonly T[],
): { team: T | null; ambiguous: boolean } {
  if (rows.length === 1) return { team: rows[0]!, ambiguous: false };
  if (rows.length > 1) return { team: null, ambiguous: true };
  return { team: null, ambiguous: false };
}

/** ¿Es un id de inscripción de equipo (teamId sidgad, `wse_1130`…) y no un club/abreviatura/nombre? */
function isInscriptionRef(ref: string): boolean {
  return /^(?:[a-z]+_)?\d+$/.test(ref) && !/_club_|abbr/.test(ref);
}

/**
 * ¿Tiene sentido que un humano revise esta ref en la cola HITL?
 * Sólo los nombres. Un id de club (`fep_club_102`) o de inscripción (`11846`,
 * `wse_1130`) no da candidatos ni se puede reconocer a ojo: llenaba la cola de
 * ruido con miles de avistamientos y tapaba los nombres de verdad.
 */
export function isReviewableName(ref: string): boolean {
  if (isClubRef(ref) || /^[a-z]+_club_/.test(ref)) return false;
  return !/^(?:[a-z]+_)?\d+$/.test(ref);
}

export class RefResolver {
  // Caché: ref → UUID
  private teamCache = new Map<string, string>();
  private competitionCache = new Map<string, string>();
  private seasonCache = new Map<string, string>();

  private sportId: string;

  constructor(sportId: string) {
    this.sportId = sportId;
  }

  /**
   * Resuelve teamRef (ID de la fuente o nombre) → team UUID.
   *
   * Cascada del embudo (Fase 1). El orden preserva el comportamiento previo: el
   * escalón nuevo de `team_aliases` va ENTRE el slug y la similitud, nunca antes,
   * así que jamás resuelve peor que la versión anterior; sólo añade caminos
   * deterministas más tempranos.
   *
   *   1. source_entity_map (ID de fuente → team, determinista)     [escalón 1]
   *   2. teams.source_ref / alt_source_refs (puente hacia el mapa)  [escalón 1 bis]
   *   3. slug (nombre slugificado, exacto)
   *   4. team_aliases.normalized (alias exacto normalizado)        [escalón 2]
   *   5. fuzzy con bloqueo → cola HITL (no auto-confirma)          [escalón 3-4]
   *
   * `sourceId` (UUID de data_sources) habilita el escalón 1 y que el resolver
   * ALIMENTE el mapa al resolver por el puente, para que la próxima vez entre
   * por el escalón 1 (coste cero).
   */
  async resolveTeam(
    teamRef: string,
    sourceId?: string,
    signals?: { gender?: string | null; ageCategory?: string | null },
    seasonId?: string,
    queueCtx?: { seasonId?: string },
  ): Promise<string> {
    teamRef = collapseRepeatedTeamLetter(teamRef);
    const cacheKey = `${sourceId ?? ''}|${seasonId ?? ''}|${teamRef}`;
    const cached = this.teamCache.get(cacheKey);
    if (cached) return cached;

    // 0. Ref de inscripción en ESTA temporada (A5). Una temporada es de un
    //    solo portal: (temporada, ref) es determinista aunque la ref choque
    //    entre portales (#228) o cambie de una temporada a otra.
    if (seasonId) {
      const bySeason = await findTeamIdBySeasonRef(seasonId, teamRef);
      if (bySeason) {
        this.teamCache.set(cacheKey, bySeason);
        return bySeason;
      }
    }

    // 1. source_entity_map (escalón 1 determinista)
    let teamId = await resolveTeamViaSourceMap(teamRef, sourceId);
    // Una ref de fuente designa una SECCIÓN (género/categoría), no sólo un club.
    // Si el mapa apunta a un equipo que contradice las señales de la competición,
    // el mapeo está corrupto (p. ej. un ref masculino reasignado a la ficha
    // femenina): no se acepta y se sigue la cascada. Sin esto, un mapa viejo
    // contaminaba con datos de un género la ficha del otro.
    if (teamId) {
      const mapped = await findTeamById(teamId);
      if (mapped && signalsConflict(mapped, signals)) {
        log.warn(
          { teamRef, sourceId, candidato: mapped.name, gender: mapped.gender ?? null, ageCategory: mapped.age_category ?? null },
          'source_entity_map contradice las señales de la competición (#194) — se descarta y sigue la cascada',
        );
        teamId = null;
      }
    }

    // 2. Puente: teams.source_ref / alt_source_refs. Si resuelve y tenemos
    //    fuente, se alimenta el mapa para que la próxima entre por el escalón 1.
    //    #228: si la ref casa con >1 equipo (colisión entre portales sidgad), NO
    //    se resuelve por ref — coger "la primera" es resolver el equipo
    //    equivocado en silencio. Se sigue la cascada (slug/alias/fuzzy/HITL).
    if (!teamId) {
      const { team, ambiguous } = pickUnambiguousTeam(await findTeamsBySourceRef(teamRef));
      if (ambiguous) {
        log.warn(
          { teamRef, sourceId },
          'Ref casada con >1 equipo (colisión entre portales, #228) — no se resuelve por ref; sigue la cascada'
        );
      } else if (team) {
        if (signalsConflict(team, signals)) {
          log.warn(
            { teamRef, sourceId, candidato: team.name, gender: team.gender ?? null, ageCategory: team.age_category ?? null },
            'Equipo por source_ref con señales contradictorias (#194) — se descarta y sigue la cascada',
          );
        } else {
          teamId = team.id;
          if (sourceId) {
            await upsertSourceEntityMapTeam(sourceId, teamRef, team.id).catch((err) => {
              log.debug({ teamRef, sourceId, err }, 'No se pudo alimentar source_entity_map');
            });
          }
        }
      }
    }

    // 3. Por slug (nombre slugificado). CON GUARDA DE SEÑALES (#194): un slug
    //    es sólo el nombre normalizado — "CD Ourense" masculino y femenino
    //    comparten slug, y aceptar el primero fabricaba una fusión silenciosa
    //    entre equipos de género/categoría distinta. Si el candidato CONOCE su
    //    género/categoría y contradice las señales de la competición, no se
    //    acepta: la cascada sigue (alias/fuzzy) y, sin resolución, el ref
    //    termina en la cola HITL en vez de en un equipo equivocado.
    if (!teamId) {
      const slug = slugify(teamRef);
      const team = await findTeamBySlug(this.sportId, slug);
      if (team && !signalsConflict(team, signals)) {
        teamId = team.id;
        log.debug({ teamRef, slug, method: 'slug' }, 'Equipo resuelto por slug');
      } else if (team && signalsConflict(team, signals)) {
        log.warn(
          { teamRef, slug, candidato: team.name, gender: team.gender ?? null, ageCategory: team.age_category ?? null },
          'Candidato por slug con señales contradictorias (#194) — se descarta y sigue la cascada'
        );
      }
    }

    // 4. team_aliases: alias exacto normalizado (escalón 2)
    if (!teamId) {
      const normalized = normalizeTeamName(teamRef);
      const aliasTeamId = await findTeamByNormalizedAlias(normalized, sourceId);
      if (aliasTeamId) {
        // Un alias es sólo un NOMBRE: "CH MATARÓ" designa a la vez al equipo
        // masculino y al femenino del club. Aceptarlo sin mirar las señales es
        // exactamente cómo la clasificación masculina acabó colgando de la ficha
        // femenina (#194). Si contradice género/categoría, se descarta.
        const aliasTeam = await findTeamById(aliasTeamId);
        if (aliasTeam && signalsConflict(aliasTeam, signals)) {
          log.warn(
            { teamRef, normalized, candidato: aliasTeam.name, gender: aliasTeam.gender ?? null, ageCategory: aliasTeam.age_category ?? null },
            'Alias con señales contradictorias (#194) — se descarta y sigue la cascada',
          );
        } else {
          teamId = aliasTeamId;
          log.debug({ teamRef, normalized, method: 'alias' }, 'Equipo resuelto por alias normalizado');
        }
      }
    }

    // 5. Fuzzy con bloqueo: auto-confirmación con señales (escalón 3, Fase 3)
    //    o, si hay duda, cola HITL (escalón 4). NUNCA se auto-confirma a ciegas
    //    por similitud (el viejo umbral 0.4 fue el origen del duplicado del Liceo).
    if (!teamId && sourceId) {
      const normalized = normalizeTeamName(teamRef);

      // 5a. Auto-confirmación (Fase 3): SÓLO con similitud ≥0.95 Y señales
      //     consistentes (mismo género y categoría) Y candidato inequívoco. Sin
      //     señales no se auto-confirma: género+categoría son lo que evita el
      //     falso positivo semántico.
      if (signals?.gender && signals?.ageCategory) {
        const auto = await autoConfirmTeam(normalized, this.sportId, signals.gender, signals.ageCategory);
        if (auto) {
          teamId = auto.teamId;
          // Aprendizaje: registrar el alias (created_by='fuzzy', reversible y auditable).
          await upsertTeamAlias({
            teamId, rawText: teamRef, normalized, sourceId,
            createdBy: 'fuzzy', confidence: auto.score,
          }).catch((err) => log.debug({ teamRef, err }, 'No se pudo registrar alias auto-confirmado'));
          log.info(
            { teamRef, resolvedName: auto.name, score: auto.score, method: 'auto-fuzzy' },
            'Auto-confirmado por similitud + señales (≥0.95)'
          );
        }
      }

      // 5b. Si no se auto-confirmó, a la cola HITL para revisión humana.
      if (!teamId && isReviewableName(teamRef)) {
        // Candidatos de la MISMA sección (género + categoría): sin este filtro
        // el panel proponía el Bembibre femenino para un equipo italiano.
        const candidates = (await findSimilarTeamNames(teamRef, this.sportId, signals, 3))
          .map((c) => ({ teamId: c.teamId, name: c.name, score: c.score }));
        await enqueueResolution({
          rawText: teamRef,
          normalized,
          sourceId,
          sourceRef: teamRef,
          // Contexto para el panel: de qué temporada/competición y sección viene.
          context: {
            sportId: this.sportId,
            seasonId: queueCtx?.seasonId ?? seasonId ?? null,
            gender: signals?.gender ?? null,
            ageCategory: signals?.ageCategory ?? null,
          },
          candidates,
        }).catch((err) => {
          log.debug({ teamRef, err }, 'No se pudo encolar en resolution_queue');
        });
        log.warn(
          { teamRef, candidatos: candidates.length, method: 'queue' },
          'Ref no resuelto por escalones deterministas → encolado para revisión (HITL)'
        );
      }
    }

    if (!teamId) {
      throw new Error(
        `No se encontró equipo para ref "${teamRef}" (sport_id: ${this.sportId}). ` +
        `¿Se ha ejecutado el scraper de equipos antes que el de partidos?`
      );
    }

    // A5: aprende la ref de inscripción para esta temporada (solo ids de
    // inscripción: ni refs de club ni abreviaturas, que no son de temporada).
    if (seasonId && isInscriptionRef(teamRef)) {
      await recordSeasonTeamRef(seasonId, teamId, teamRef).catch((err) => {
        log.debug({ teamRef, seasonId, err }, 'No se pudo registrar la ref de inscripción');
      });
    }
    this.teamCache.set(cacheKey, teamId);
    return teamId;
  }

  async resolveCompetition(ref: string, slug?: string): Promise<string> {
    const cached = this.competitionCache.get(ref);
    if (cached) return cached;

    let competition = await findCompetitionBySourceRef(ref);

    if (!competition && slug) {
      competition = await findCompetitionBySlug(this.sportId, slug);
    }

    if (!competition) {
      throw new Error(`No se encontró competición para ref "${ref}"`);
    }

    this.competitionCache.set(ref, competition.id);
    return competition.id;
  }

  async resolveSeason(ref: string): Promise<string> {
    const cached = this.seasonCache.get(ref);
    if (cached) return cached;

    const season = await findSeasonBySourceRef(ref);
    if (!season) {
      throw new Error(`No se encontró temporada para ref "${ref}"`);
    }

    this.seasonCache.set(ref, season.id);
    return season.id;
  }

  /** Vaciar caché (útil entre runs de distintos contextos) */
  clearCache(): void {
    this.teamCache.clear();
    this.competitionCache.clear();
    this.seasonCache.clear();
  }
}

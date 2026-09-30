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
  findTeamBySourceRef,
  findTeamBySlug,
  resolveTeamViaSourceMap,
  upsertSourceEntityMapTeam,
  findTeamByNormalizedAlias,
  generateFuzzyCandidates,
  enqueueResolution,
  autoConfirmTeam,
  upsertTeamAlias,
  findCompetitionBySourceRef,
  findCompetitionBySlug,
  findSeasonBySourceRef,
  type DbTeam,
} from '@sports/db';
import { createLogger } from '@sports/logger';
import { slugify } from '../transformers/slugify.js';
import { normalizeTeamName } from '../transformers/normalize.js';

const log = createLogger({ module: 'ref-resolver' });

/**
 * ¿Contradice el equipo las señales de la competición? (#194)
 *
 * Sólo se considera conflicto cuando AMBOS lados conocen el dato (NULL en la
 * BD = legado sin clasificar: no bloquea). El género y la categoría son más
 * discriminantes que el nombre: son lo que separa al filial del primer equipo
 * y al equipo femenino del masculino.
 */
function signalsConflict(
  team: DbTeam,
  signals?: { gender?: string | null; ageCategory?: string | null },
): boolean {
  if (!signals) return false;
  if (team.gender && signals.gender && team.gender !== signals.gender) return true;
  if (team.age_category && signals.ageCategory && team.age_category !== signals.ageCategory) return true;
  return false;
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
  ): Promise<string> {
    const cacheKey = `${sourceId ?? ''}|${teamRef}`;
    const cached = this.teamCache.get(cacheKey);
    if (cached) return cached;

    // 1. source_entity_map (escalón 1 determinista)
    let teamId = await resolveTeamViaSourceMap(teamRef, sourceId);

    // 2. Puente: teams.source_ref / alt_source_refs. Si resuelve y tenemos
    //    fuente, se alimenta el mapa para que la próxima entre por el escalón 1.
    if (!teamId) {
      const team = await findTeamBySourceRef(teamRef);
      if (team) {
        teamId = team.id;
        if (sourceId) {
          await upsertSourceEntityMapTeam(sourceId, teamRef, team.id).catch((err) => {
            log.debug({ teamRef, sourceId, err }, 'No se pudo alimentar source_entity_map');
          });
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
        teamId = aliasTeamId;
        log.debug({ teamRef, normalized, method: 'alias' }, 'Equipo resuelto por alias normalizado');
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
      if (!teamId) {
        const candidates = await generateFuzzyCandidates(normalized, this.sportId, 3);
        await enqueueResolution({
          rawText: teamRef,
          normalized,
          sourceId,
          sourceRef: teamRef,
          context: { sportId: this.sportId },
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

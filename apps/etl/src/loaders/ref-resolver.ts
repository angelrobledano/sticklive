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
  findTeamByNameSimilarity,
  addTeamAltRef,
  resolveTeamViaSourceMap,
  upsertSourceEntityMapTeam,
  findTeamByNormalizedAlias,
  findCompetitionBySourceRef,
  findCompetitionBySlug,
  findSeasonBySourceRef,
} from '@sports/db';
import { createLogger } from '@sports/logger';
import { slugify } from '../transformers/slugify.js';
import { normalizeTeamName } from '../transformers/normalize.js';

const log = createLogger({ module: 'ref-resolver' });

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
   *   5. similitud de nombre (pg_trgm, fallback)
   *
   * `sourceId` (UUID de data_sources) habilita el escalón 1 y que el resolver
   * ALIMENTE el mapa al resolver por el puente, para que la próxima vez entre
   * por el escalón 1 (coste cero).
   */
  async resolveTeam(teamRef: string, sourceId?: string): Promise<string> {
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

    // 3. Por slug (nombre slugificado)
    if (!teamId) {
      const slug = slugify(teamRef);
      const team = await findTeamBySlug(this.sportId, slug);
      if (team) {
        teamId = team.id;
        log.debug({ teamRef, slug, method: 'slug' }, 'Equipo resuelto por slug');
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

    // 5. Por similitud de nombre (fallback)
    if (!teamId) {
      const team = await findTeamByNameSimilarity(this.sportId, teamRef);
      if (team) {
        teamId = team.id;
        log.warn(
          { teamRef, resolvedName: team.name, method: 'similarity' },
          '⚠️  Equipo resuelto por similitud de nombre — verificar que es correcto'
        );
        // Auto-registro del ref como alternativo (sólo refs legibles, no IDs
        // opacos): la próxima vez lo resuelve el puente/escalón 1 sin similitud.
        await addTeamAltRef(team.id, teamRef).catch((err) => {
          log.debug({ teamId: team.id, teamRef, err }, 'No se pudo registrar alt_ref');
        });
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

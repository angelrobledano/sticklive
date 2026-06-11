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
  findCompetitionBySourceRef,
  findCompetitionBySlug,
  findSeasonBySourceRef,
} from '@sports/db';
import { createLogger } from '@sports/logger';
import { slugify } from '../transformers/slugify.js';

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
   * Resuelve teamRef (ID de la fuente o nombre) → team UUID en nuestra DB.
   * teamRef puede ser: source_ref, nombre completo, o slug.
   */
  async resolveTeam(teamRef: string): Promise<string> {
    const cached = this.teamCache.get(teamRef);
    if (cached) return cached;

    // 1. Por source_ref exacto
    let team = await findTeamBySourceRef(teamRef);

    // 2. Por slug
    if (!team) {
      const slug = slugify(teamRef);
      team = await findTeamBySlug(this.sportId, slug);
      if (team) {
        log.debug({ teamRef, slug, method: 'slug' }, 'Equipo resuelto por slug');
      }
    }

    // 3. Por similitud de nombre (fallback)
    if (!team) {
      team = await findTeamByNameSimilarity(this.sportId, teamRef);
      if (team) {
        log.warn(
          { teamRef, resolvedName: team.name, method: 'similarity' },
          '⚠️  Equipo resuelto por similitud de nombre — verificar que es correcto'
        );
        // Auto-registro: guardar este ref como alternativo para que la
        // próxima ejecución lo resuelva directamente sin pasar por similitud.
        // Solo útil para refs legibles (nombres), no para IDs opacos (fep_club_44).
        await addTeamAltRef(team.id, teamRef).catch((err) => {
          log.debug({ teamId: team!.id, teamRef, err }, 'No se pudo registrar alt_ref');
        });
      }
    }

    if (!team) {
      throw new Error(
        `No se encontró equipo para ref "${teamRef}" (sport_id: ${this.sportId}). ` +
        `¿Se ha ejecutado el scraper de equipos antes que el de partidos?`
      );
    }

    this.teamCache.set(teamRef, team.id);
    return team.id;
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

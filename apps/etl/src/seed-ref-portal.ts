/**
 * ¿Qué equipo es la ref de sidgad `5177` en ESTE portal?
 *
 * Cada portal (rfep, fecapa, fisr, fgp…) numera sus equipos aparte, así que
 * la ref solo vale si el equipo estuvo inscrito con ella en una competición
 * del mismo portal. Un dueño de otro portal es otro equipo, no un candidato.
 */
import { sourceForCompetitionRef } from '../../scraper/src/core/sources.js';

export type RefOwner = { teamId: string; competitionSourceRef: string | null };

export function pickRefOwnerForPortal(
  owners: RefOwner[],
  portalKey: string,
): { teamId: string } | { ambiguous: string[] } | null {
  const ids = [...new Set(
    owners.filter((o) => sourceForCompetitionRef(o.competitionSourceRef)?.key === portalKey).map((o) => o.teamId),
  )];
  if (ids.length === 1) return { teamId: ids[0]! };
  if (ids.length > 1) return { ambiguous: ids };
  return null;
}

/** ¿Algún dueño de la ref es de OTRO portal? (para no usar el puente global teams.source_ref). */
export function ownedByOtherPortal(owners: RefOwner[], portalKey: string): boolean {
  return owners.some((o) => sourceForCompetitionRef(o.competitionSourceRef)?.key !== portalKey);
}

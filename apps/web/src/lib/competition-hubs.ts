/**
 * Datos de los hubs de país y federación (server). Puro sobre lo que devuelve
 * la API para poder testearlo sin red.
 */
import type { CompetitionSummary, Federation } from '@/lib/api/client';
import { currentSeasonYear, hasSeasonYear } from '@/lib/competition-importance';
import { competitionCountry, competitionsUnderFederation, isInternational } from '@/lib/competition-groups';

/** Solo la temporada vigente si la hay; si el hub no tiene ninguna, todo. */
function preferCurrent(comps: CompetitionSummary[], all: CompetitionSummary[]): CompetitionSummary[] {
  const year = currentSeasonYear(all);
  if (year == null) return comps;
  const current = comps.filter((c) => hasSeasonYear(c, year));
  return current.length > 0 ? current : comps;
}

export function countryHubCompetitions(all: CompetitionSummary[], code: string): CompetitionSummary[] {
  const cc = code.toUpperCase();
  return preferCurrent(all.filter((c) => !isInternational(c) && competitionCountry(c) === cc), all);
}

export function federationHubCompetitions(
  all: CompetitionSummary[],
  fed: Federation,
  federations: Federation[],
): CompetitionSummary[] {
  return preferCurrent(competitionsUnderFederation(all, fed.code, federations), all);
}

/** Países con hub: los que tienen al menos una competición no internacional. */
export function hubCountries(all: CompetitionSummary[]): string[] {
  const set = new Set<string>();
  for (const c of all) {
    if (isInternational(c)) continue;
    const cc = competitionCountry(c);
    if (cc && cc.length === 2) set.add(cc);
  }
  return [...set].sort();
}

/** Federaciones con hub: las que tienen competiciones colgando (ellas o sus hijas). */
export function hubFederations(all: CompetitionSummary[], federations: Federation[]): Federation[] {
  return federations.filter((f) => competitionsUnderFederation(all, f.code, federations).length > 0);
}

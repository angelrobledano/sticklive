import type { CompetitionSummary } from '@/lib/api/client';

/**
 * Normaliza texto para comparar: minúsculas y sin acentos (NFD + diacríticos).
 * Mismo criterio que la búsqueda global de la API (`normalizeSearchTerm`).
 */
export function normalizeSearchText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** ¿La competición casa con el término (ya normalizado) en alguno de sus campos? */
export function matchesCompetitionQuery(
  c: CompetitionSummary,
  normalizedQuery: string,
  countryName: string,
): boolean {
  return (
    normalizeSearchText(c.name).includes(normalizedQuery) ||
    normalizeSearchText(c.shortName ?? '').includes(normalizedQuery) ||
    normalizeSearchText(countryName).includes(normalizedQuery) ||
    normalizeSearchText(c.region ?? '').includes(normalizedQuery) ||
    normalizeSearchText(c.organizer).includes(normalizedQuery)
  );
}

/**
 * Filtra competiciones por texto sobre TODAS las temporadas (#256): una
 * competición cuya última temporada no contiene el año vigente también debe
 * poder encontrarse. El nombre del país se delega para respetar el idioma activo.
 */
export function filterCompetitions(
  comps: CompetitionSummary[],
  query: string,
  countryNameFor: (code: string | null) => string,
): CompetitionSummary[] {
  const q = normalizeSearchText(query.trim());
  if (!q) return comps;
  return comps.filter((c) => matchesCompetitionQuery(c, q, countryNameFor(c.country)));
}

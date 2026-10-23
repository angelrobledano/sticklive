import type { CompetitionSummary } from '@/lib/api/client';
import { normalizeSearchText } from '@/lib/search-text';
import { importanceRank, orderByImportance } from '@/lib/competition-importance';

// Se reexporta para no romper los imports existentes (`CompetitionsList`, tests).
export { normalizeSearchText } from '@/lib/search-text';

/**
 * Nombres de la competición en sus distintos idiomas. `nameI18n` es
 * `{es: name}` o `null` hoy (names.ts / migración 038), pero buscar debe cubrir
 * también los nombres traducidos que la UI puede llegar a pintar (#262).
 */
function nameVariants(c: CompetitionSummary): string[] {
  return c.nameI18n ? Object.values(c.nameI18n) : [];
}

/** ¿La competición casa con el término (ya normalizado) en alguno de sus campos? */
export function matchesCompetitionQuery(
  c: CompetitionSummary,
  normalizedQuery: string,
  countryName: string,
): boolean {
  return (
    normalizeSearchText(c.name).includes(normalizedQuery) ||
    nameVariants(c).some((n) => normalizeSearchText(n).includes(normalizedQuery)) ||
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

/** Relevancia de un texto frente a la query (menor = mejor). */
function textRelevance(text: string, normalizedQuery: string): number {
  const n = normalizeSearchText(text);
  if (!n) return 3;
  if (n === normalizedQuery) return 0;
  if (n.startsWith(normalizedQuery)) return 1;
  if (n.split(/\s+/).some((word) => word.startsWith(normalizedQuery))) return 2;
  return 3;
}

/**
 * Relevancia del match (menor = mejor): 0 exacto, 1 prefijo, 2 inicio de palabra,
 * 3 contiene. Se calcula sobre el nombre, sus traducciones y el nombre corto,
 * quedándose con el mejor (#260).
 */
export function matchRelevance(c: CompetitionSummary, normalizedQuery: string): number {
  if (!normalizedQuery) return 3;
  const fields = [c.name, ...nameVariants(c), c.shortName ?? ''];
  return Math.min(...fields.map((f) => textRelevance(f, normalizedQuery)));
}

/**
 * Ordena resultados de búsqueda por relevancia (exacto/prefijo primero) y, en
 * empate, por importancia y nombre en el locale (#260). Sin término delega en
 * `orderByImportance`. No muta la entrada.
 */
export function orderSearchResults(
  comps: CompetitionSummary[],
  normalizedQuery: string,
  locale: string,
): CompetitionSummary[] {
  if (!normalizedQuery) return orderByImportance(comps, locale);
  return [...comps].sort((a, b) => {
    const byRelevance = matchRelevance(a, normalizedQuery) - matchRelevance(b, normalizedQuery);
    if (byRelevance !== 0) return byRelevance;
    const byImportance = importanceRank(a) - importanceRank(b);
    return byImportance !== 0 ? byImportance : a.name.localeCompare(b.name, locale);
  });
}

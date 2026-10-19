/**
 * Navegación entre temporadas de una competición.
 *
 * `getCompetitionSeasons` devuelve las temporadas de la más reciente a la más
 * antigua (`ORDER BY start_date DESC`). La "anterior" a la seleccionada es la
 * siguiente del array. Si no hay más, null.
 */
export function previousSeason<T extends { id: string }>(
  seasons: readonly T[],
  selectedId: string,
): T | null {
  const index = seasons.findIndex((season) => season.id === selectedId);
  if (index < 0) return null;
  return seasons[index + 1] ?? null;
}

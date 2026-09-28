/**
 * #344: decide qué mostrar en la zona de catálogo de Favoritos. La regla clave
 * es que un ERROR de API tiene prioridad sobre el estado vacío: si el fetch
 * falla, el usuario no debe ver "no sigues a nadie" / "nada que coincida", porque
 * creería que perdió sus favoritos. Función pura para fijar la precedencia.
 *
 * Vive FUERA de `page.tsx`: Next solo permite exports de ruta en una página
 * (default/metadata/…); cualquier export extra hace fallar `next build`.
 */
export type FavoritesCatalogState = 'loading' | 'error' | 'onboarding' | 'no-results' | 'content';

export function favoritesCatalogState(input: {
  loading: boolean;
  hasError: boolean;
  mounted: boolean;
  hasAnyFavorites: boolean;
  query: string;
  matchCount: number;
}): FavoritesCatalogState {
  if (input.loading) return 'loading';
  if (input.hasError) return 'error';
  if (input.matchCount > 0) return 'content';
  if (input.mounted && !input.hasAnyFavorites && input.query.trim() === '') return 'onboarding';
  if (input.query.trim().length > 0) return 'no-results';
  return 'content';
}

import { describe, it, expect, vi } from 'vitest';
import { favoritesCatalogState } from './state';

/**
 * #344: un fallo de API NO puede presentarse como catálogo vacío. El estado de
 * error tiene prioridad sobre "onboarding"/"sin resultados", para que el usuario
 * con favoritos no crea que los ha perdido.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {}, prefetch: () => {} }),
  usePathname: () => '/es/favorites',
  useSearchParams: () => new URLSearchParams(),
}));

const base = {
  loading: false,
  hasError: false,
  mounted: true,
  hasAnyFavorites: true,
  query: '',
  matchCount: 0,
};

describe('favoritesCatalogState (#344)', () => {
  it('un error de API gana al estado vacío/onboarding aunque vacíe el catálogo', () => {
    expect(favoritesCatalogState({ ...base, hasError: true })).toBe('error');
    expect(
      favoritesCatalogState({ ...base, hasError: true, hasAnyFavorites: false, matchCount: 0 }),
    ).toBe('error');
  });

  it('mientras carga, se muestra carga (no error)', () => {
    expect(favoritesCatalogState({ ...base, loading: true, hasError: true })).toBe('loading');
  });

  it('sin favoritos ni búsqueda activa muestra onboarding', () => {
    expect(
      favoritesCatalogState({ ...base, hasAnyFavorites: false, matchCount: 0 }),
    ).toBe('onboarding');
  });

  it('con resultados muestra contenido', () => {
    expect(favoritesCatalogState({ ...base, matchCount: 2 })).toBe('content');
  });

  it('con búsqueda sin coincidencias muestra "sin resultados" (no error)', () => {
    expect(favoritesCatalogState({ ...base, query: 'girona' })).toBe('no-results');
  });
});

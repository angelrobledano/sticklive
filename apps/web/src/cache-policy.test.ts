import { describe, it, expect, vi } from 'vitest';

// `next.config.mjs` no puede ejecutarse entero en test (envuelve Sentry): lo
// neutralizamos para probar solo la decisión pura de caché por ruta (#351).
vi.mock('@sentry/nextjs', () => ({ withSentryConfig: (config: unknown) => config }));

import { htmlCacheControlForPath } from '../next.config.mjs';

const COMPETITION_DETAIL = 'public, s-maxage=30, stale-while-revalidate=300';

describe('htmlCacheControlForPath (#351)', () => {
  it('cachea el HTML de la ficha de competición en todos los idiomas', () => {
    expect(
      htmlCacheControlForPath('/es/competitions/0073f9aa-1111-4222-8333-444455556666'),
    ).toBe(COMPETITION_DETAIL);
    expect(htmlCacheControlForPath('/en/competitions/9bc7cb2c-9c9c-4bd1-9474-b86da60d4be5')).toBe(
      COMPETITION_DETAIL,
    );
  });

  it('no cachea el listado, rutas anidadas ni locales no soportados', () => {
    expect(htmlCacheControlForPath('/es/competitions')).toBeNull();
    expect(htmlCacheControlForPath('/es/competitions/x/opengraph-image')).toBeNull();
    expect(htmlCacheControlForPath('/xx/competitions/x')).toBeNull();
    expect(htmlCacheControlForPath('/es/matches/x')).toBeNull();
    expect(htmlCacheControlForPath('/es')).toBeNull();
    expect(htmlCacheControlForPath('/')).toBeNull();
  });
});

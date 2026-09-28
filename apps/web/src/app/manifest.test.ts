import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * #363 — el manifest PWA es dinámico: `lang` y los `shortcuts` siguen el idioma
 * activo (cookie `sticklive_locale` > Accept-Language > fallback 'en'), igual
 * que el middleware de i18n. `theme_color` debe coincidir con el meta
 * theme-color claro para que el marco de la app instalada no cambie.
 */

const mockState = vi.hoisted(() => ({ headers: {} as Record<string, string> }));

vi.mock('next/headers', () => ({
  headers: async () => new Headers(mockState.headers),
}));

import manifest from './manifest';

beforeEach(() => {
  mockState.headers = {};
});

describe('manifest PWA — idioma dinámico (#363)', () => {
  it('usa el locale de la cookie sticklive_locale', async () => {
    mockState.headers = { cookie: 'sticklive_locale=fr' };
    const m = await manifest();
    expect(m.lang).toBe('fr');
    expect(m.shortcuts?.map((s) => s.name)).toEqual(['Favoris', 'Compétitions']);
  });

  it('cae a Accept-Language si no hay cookie', async () => {
    mockState.headers = { 'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8' };
    const m = await manifest();
    expect(m.lang).toBe('pt');
  });

  it('la cookie manda sobre Accept-Language', async () => {
    mockState.headers = { cookie: 'sticklive_locale=it', 'accept-language': 'en-US' };
    const m = await manifest();
    expect(m.lang).toBe('it');
  });

  it("fallback 'en' sin cookie ni Accept-Language", async () => {
    const m = await manifest();
    expect(m.lang).toBe('en');
  });
});

describe('manifest PWA — start_url, tema y atajos (#363)', () => {
  it('start_url raíz y display standalone (start_url lo resuelve el middleware por cookie)', async () => {
    const m = await manifest();
    expect(m.start_url).toBe('/');
    expect(m.display).toBe('standalone');
  });

  it('theme_color alineado con el meta theme-color claro de layout.tsx', async () => {
    const m = await manifest();
    expect(m.theme_color).toBe('#f8fafc');
  });

  it('shortcuts localizados a Favoritos y Competiciones (es)', async () => {
    mockState.headers = { cookie: 'sticklive_locale=es' };
    const m = await manifest();
    expect(m.shortcuts).toEqual([
      { name: 'Favoritos', url: '/favorites' },
      { name: 'Competiciones', url: '/competitions' },
    ]);
  });
});

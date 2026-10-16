import { describe, it, expect } from 'vitest';
import { withLocaleHref, findUnprefixedEntityLinks } from './locale-links';

/**
 * SEO-01 (`docs/AUDITORIA_SEO_2026-10-16.md`): los `href` internos salían sin
 * prefijo de idioma, el middleware los redirigía con 307 y Googlebot —que no
 * manda `Accept-Language`— acababa siempre en `/en`. Cada enlace costaba dos
 * peticiones y `es/pt/fr/it` se quedaban sin enlaces internos propios.
 */

describe('withLocaleHref', () => {
  it('antepone el locale a las rutas internas', () => {
    expect(withLocaleHref('/competitions/c1', 'es')).toBe('/es/competitions/c1');
    expect(withLocaleHref('/teams/t1', 'en')).toBe('/en/teams/t1');
    expect(withLocaleHref('/matches/m1?tab=resumen', 'pt')).toBe('/pt/matches/m1?tab=resumen');
  });

  it('la raíz no duplica la barra', () => {
    expect(withLocaleHref('/', 'es')).toBe('/es');
  });

  it('no toca rutas ya localizadas ni URLs no internas', () => {
    expect(withLocaleHref('/en/teams/t1', 'es')).toBe('/en/teams/t1');
    expect(withLocaleHref('/it/competitions', 'fr')).toBe('/it/competitions');
    expect(withLocaleHref('https://sticklive.eu/es', 'es')).toBe('https://sticklive.eu/es');
    expect(withLocaleHref('#main', 'es')).toBe('#main');
  });

  it('deja fuera lo que no son rutas de la app (API, assets, ficheros)', () => {
    expect(withLocaleHref('/api/health', 'es')).toBe('/api/health');
    expect(withLocaleHref('/monitoring', 'es')).toBe('/monitoring');
    expect(withLocaleHref('/brand/lock-on-light.svg', 'es')).toBe('/brand/lock-on-light.svg');
    expect(withLocaleHref('/offline.html', 'es')).toBe('/offline.html');
    expect(withLocaleHref('/ads.txt', 'es')).toBe('/ads.txt');
  });
});

describe('findUnprefixedEntityLinks', () => {
  it('detecta las dos formas sin prefijo que usa la app', () => {
    expect(findUnprefixedEntityLinks('href="/competitions/c1"')).toHaveLength(1);
    expect(findUnprefixedEntityLinks('href={`/teams/${t.id}`}')).toHaveLength(1);
    expect(findUnprefixedEntityLinks('<a href={`/matches/${m.id}?tab=x`}>')).toHaveLength(1);
  });

  it('no marca los ya localizados ni otras rutas', () => {
    expect(findUnprefixedEntityLinks('href="/es/competitions/c1"')).toHaveLength(0);
    expect(findUnprefixedEntityLinks('href={`/en/teams/${t.id}`}')).toHaveLength(0);
    expect(findUnprefixedEntityLinks('href="/competitions-copa"')).toHaveLength(0);
    expect(findUnprefixedEntityLinks('href="/privacy"')).toHaveLength(0);
  });
});

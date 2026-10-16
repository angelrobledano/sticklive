import { describe, it, expect } from 'vitest';
import {
  sitemapSectionIds,
  sitemapEntries,
  sitemapLastModified,
  sitemapItemId,
  sitemapIndexXml,
  sitemapLanguages,
  SITEMAP_SECTION_SIZE,
  type SitemapIds,
} from './sitemap';

const ids = (o: Partial<SitemapIds> = {}): SitemapIds => ({
  competitions: o.competitions ?? [],
  teams: o.teams ?? [],
  players: o.players ?? [],
  matches: o.matches ?? [],
});

describe('sitemapSectionIds', () => {
  it('sin datos solo existe la sección core', () => {
    expect(sitemapSectionIds(ids())).toEqual(['core']);
  });

  it('crea una sección por tipo con datos', () => {
    expect(sitemapSectionIds(ids({ competitions: ['c'], teams: ['a'] })))
      .toEqual(['core', 'competitions-0', 'teams-0']);
  });

  it('trocea las listas grandes y el trozo queda por debajo del límite de Google', () => {
    const players = Array.from({ length: SITEMAP_SECTION_SIZE * 2 + 1 }, (_, i) => String(i));
    expect(sitemapSectionIds(ids({ players })))
      .toEqual(['core', 'players-0', 'players-1', 'players-2']);
    // 5 locales por entrada → el trozo × locales debe caber en 50.000.
    expect(SITEMAP_SECTION_SIZE * 5).toBeLessThanOrEqual(50_000);
  });
});

describe('sitemapEntries', () => {
  it('core son la home, el listado de competiciones y la privacidad', () => {
    expect(sitemapEntries('core', ids())).toEqual([
      { path: '', priority: 1.0, changeFrequency: 'hourly' },
      { path: '/competitions', priority: 0.9, changeFrequency: 'daily' },
      { path: '/privacy', priority: 0.3, changeFrequency: 'weekly' },
    ]);
  });

  it('un trozo de entidad toma su franja de ids', () => {
    const players = Array.from({ length: SITEMAP_SECTION_SIZE + 1 }, (_, i) => `p${i}`);
    const entries = sitemapEntries('players-1', ids({ players }));
    expect(entries).toEqual([
      { path: `/players/p${SITEMAP_SECTION_SIZE}`, priority: 0.6, changeFrequency: 'weekly' },
    ]);
  });

  it('una sección desconocida no emite nada', () => {
    expect(sitemapEntries('nope-0', ids())).toEqual([]);
  });
});

// #337: el lastmod debe derivar de los DATOS de cada entidad, nunca de
// `new Date()` (que daba el mismo timestamp a las 11.845 URLs).
describe('sitemapLastModified (#337)', () => {
  it('usa updatedAt cuando existe (última modificación real)', () => {
    const d = sitemapLastModified({ id: 'm1', updatedAt: '2026-09-20T10:00:00.000Z' });
    expect(d?.toISOString()).toBe('2026-09-20T10:00:00.000Z');
  });

  it('prefiere updatedAt sobre finishedAt/scheduledAt si coexisten', () => {
    const d = sitemapLastModified({
      id: 'm1',
      updatedAt: '2026-09-21T00:00:00.000Z',
      finishedAt: '2026-09-20T20:00:00.000Z',
      scheduledAt: '2026-09-20T18:00:00.000Z',
    });
    expect(d?.toISOString()).toBe('2026-09-21T00:00:00.000Z');
  });

  it('cae a finishedAt y, sin este, a scheduledAt', () => {
    expect(sitemapLastModified({ id: 'm1', finishedAt: '2026-09-20T20:00:00.000Z' })?.toISOString())
      .toBe('2026-09-20T20:00:00.000Z');
    expect(sitemapLastModified({ id: 'm1', scheduledAt: '2026-09-20T18:00:00.000Z' })?.toISOString())
      .toBe('2026-09-20T18:00:00.000Z');
  });

  it('acepta Date y salta fechas inválidas hasta la siguiente válida', () => {
    expect(sitemapLastModified({ id: 'x', updatedAt: new Date('2026-01-01T00:00:00.000Z') })?.toISOString())
      .toBe('2026-01-01T00:00:00.000Z');
    expect(sitemapLastModified({ id: 'x', updatedAt: 'no-es-fecha', scheduledAt: '2026-01-02T00:00:00.000Z' })?.toISOString())
      .toBe('2026-01-02T00:00:00.000Z');
  });

  it('devuelve null cuando no hay ninguna fecha válida (se omite lastmod)', () => {
    expect(sitemapLastModified({ id: 'x' })).toBeNull();
    expect(sitemapLastModified({ id: 'x', updatedAt: null })).toBeNull();
    expect(sitemapLastModified('x')).toBeNull();
  });
});

describe('sitemapItemId (#337)', () => {
  it('acepta ids en forma de string o de objeto', () => {
    expect(sitemapItemId('t1')).toBe('t1');
    expect(sitemapItemId({ id: 't2', updatedAt: '2026-01-01T00:00:00.000Z' })).toBe('t2');
  });
});

describe('sitemapEntries con lastmod (#337)', () => {
  it('adjunta lastModified a las entradas con datos', () => {
    const entries = sitemapEntries('matches-0', ids({
      matches: [{ id: 'm1', finishedAt: '2026-09-20T20:00:00.000Z' }],
    }));
    expect(entries).toEqual([{
      path: '/matches/m1',
      priority: 0.6,
      changeFrequency: 'hourly',
      lastModified: new Date('2026-09-20T20:00:00.000Z'),
    }]);
  });

  it('no emite lastModified en core (sin datos de entidad)', () => {
    expect(sitemapEntries('core', ids()).every((e) => !('lastModified' in e))).toBe(true);
  });

  it('sigue aceptando ids en forma de string sin lastModified (retrocompatible)', () => {
    expect(sitemapEntries('teams-0', ids({ teams: ['t1'] }))).toEqual([
      { path: '/teams/t1', priority: 0.7, changeFrequency: 'daily' },
    ]);
  });
});

// Next 16 no genera índice con `generateSitemaps()`: publica cada sección en
// `/sitemap/<id>.xml` y nada más. Sin índice propio, el `Sitemap:` de
// `robots.txt` apuntaba a un `/sitemap.xml` que devuelve 404 y Google no veía
// ninguna sección (las 14.050 URLs del sitemap quedaban invisibles).
describe('sitemapIndexXml', () => {
  it('declara cada sección con su URL absoluta', () => {
    const xml = sitemapIndexXml(['core', 'teams-0'], 'https://sticklive.eu');
    expect(xml).toContain('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).toContain('<loc>https://sticklive.eu/sitemap/core.xml</loc>');
    expect(xml).toContain('<loc>https://sticklive.eu/sitemap/teams-0.xml</loc>');
  });

  it('es un XML bien formado (declaración y cierre)', () => {
    const xml = sitemapIndexXml(sitemapSectionIds(ids()), 'https://sticklive.eu');
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml.trimEnd().endsWith('</sitemapindex>')).toBe(true);
  });

  it('emite un <sitemap> por sección: siempre al menos core', () => {
    const xml = sitemapIndexXml(sitemapSectionIds(ids({ teams: ['t1'] })), 'https://sticklive.eu');
    expect((xml.match(/<sitemap>/g) ?? []).length).toBe(2);
  });
});

// El HTML declara `x-default` (localeAlternates) pero el sitemap no lo repetía:
// dos señales hreflang distintas para la misma página. Deben coincidir.
describe('sitemapLanguages', () => {
  it('emite un hreflang por idioma más x-default → inglés', () => {
    expect(sitemapLanguages('/teams/t1', 'https://sticklive.eu', ['es', 'en', 'pt'])).toEqual({
      es: 'https://sticklive.eu/es/teams/t1',
      en: 'https://sticklive.eu/en/teams/t1',
      pt: 'https://sticklive.eu/pt/teams/t1',
      'x-default': 'https://sticklive.eu/en/teams/t1',
    });
  });

  it('en la raíz no genera doble barra', () => {
    expect(sitemapLanguages('', 'https://sticklive.eu', ['es'])['es']).toBe('https://sticklive.eu/es');
  });
});

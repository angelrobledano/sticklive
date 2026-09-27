import { describe, it, expect } from 'vitest';
import {
  sitemapSectionIds,
  sitemapEntries,
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
  it('core son la home y el listado de competiciones', () => {
    expect(sitemapEntries('core', ids())).toEqual([
      { path: '', priority: 1.0, changeFrequency: 'hourly' },
      { path: '/competitions', priority: 0.9, changeFrequency: 'daily' },
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

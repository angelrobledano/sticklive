import { describe, expect, it } from 'vitest';
import { ogCheckIssues, pageCheckIssues } from './seo-check';
import type { PageFacts } from './seo-crawl';

const URL = 'https://sticklive.eu/es/teams/t1';

const facts = (over: Partial<PageFacts> = {}): PageFacts => ({
  lang: 'es',
  title: 'CP Tordera | Stick Live',
  titleInHead: true,
  metaDescription: null,
  canonical: URL,
  canonicalInHead: true,
  robots: null,
  noindex: false,
  hreflangs: [],
  hasXDefault: true,
  h1: 'CP Tordera',
  h1Count: 1,
  jsonLdTypes: [],
  wordCount: 200,
  ogUrl: URL,
  ogImage: null,
  internalLinks: 1,
  internalLinksWithoutLocale: 0,
  ...over,
});

describe('pageCheckIssues (F6)', () => {
  it('una ficha sana no tiene incidencias', () => {
    expect(pageCheckIssues(facts(), URL)).toEqual([]);
  });

  it('detecta title/canonical fuera del head, canonical ajeno y noindex', () => {
    expect(pageCheckIssues(facts({ titleInHead: false }), URL)).toContain('title fuera del <head>');
    expect(pageCheckIssues(facts({ canonicalInHead: false }), URL)).toContain('canonical fuera del <head>');
    expect(pageCheckIssues(facts({ canonical: 'https://sticklive.eu/en/teams/t1' }), URL))
      .toContain('canonical no auto-referente (https://sticklive.eu/en/teams/t1)');
    expect(pageCheckIssues(facts({ noindex: true }), URL)).toContain('noindex en una URL del sitemap');
  });

  it('detecta la falta de canonical y de title', () => {
    expect(pageCheckIssues(facts({ canonical: null }), URL)).toContain('sin canonical');
    expect(pageCheckIssues(facts({ title: null }), URL)).toContain('sin <title>');
  });
});

describe('ogCheckIssues (F6)', () => {
  it('acepta PNG 200 y rápida', () => {
    expect(ogCheckIssues({ status: 200, contentType: 'image/png', ms: 400 })).toEqual([]);
  });

  it('detecta HTTP, formato y lentitud', () => {
    expect(ogCheckIssues({ status: 404, contentType: 'image/png', ms: 100 })).toContain('OG HTTP 404');
    expect(ogCheckIssues({ status: 200, contentType: 'image/webp', ms: 100 }))
      .toContain('OG no es PNG (image/webp)');
    expect(ogCheckIssues({ status: 200, contentType: 'image/png', ms: 2500 }))
      .toContain('OG lenta (2500 ms > 2000 ms)');
  });
});

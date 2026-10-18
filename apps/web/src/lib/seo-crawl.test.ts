import { describe, expect, it } from 'vitest';
import {
  analyzeHtml,
  canonicalMatches,
  diffReports,
  entityFromPathname,
  extractHead,
  parseSitemapLocs,
  parseUrlList,
  sampleByType,
  stripCacheBuster,
  summarizePages,
  withCacheBuster,
  type CrawlPage,
  type CrawlReport,
} from './seo-crawl';

const BASE = 'https://sticklive.eu';

function html({ head, body }: { head: string; body: string }): string {
  return `<!doctype html><html lang="es"><head>${head}</head><body>${body}</body></html>`;
}

const GOOD_HTML = html({
  head: `
    <title>OK Liga | Stick Live</title>
    <meta name="description" content="Clasificación y calendario de la OK Liga.">
    <link rel="canonical" href="${BASE}/es/competitions/c1">
    <link rel="alternate" hreflang="es" href="${BASE}/es/competitions/c1">
    <link rel="alternate" hreflang="en" href="${BASE}/en/competitions/c1">
    <link rel="alternate" hreflang="x-default" href="${BASE}/en/competitions/c1">
    <meta property="og:url" content="${BASE}/es/competitions/c1">
    <meta property="og:image" content="${BASE}/es/competitions/c1/opengraph-image">
    <script type="application/ld+json">
      {"@context":"https://schema.org","@graph":[{"@type":"SportsEvent"},{"@type":"BreadcrumbList"}]}
    </script>
  `,
  body: `
    <h1>OK Liga</h1>
    <p>Hola&nbsp;mundo &amp; adiós</p>
    <script>var x = "no cuenta";</script>
    <style>.a { color: red }</style>
    <a href="/competitions/c2">Sin idioma</a>
    <a href="/teams/t2?season=s1">Sin idioma con query</a>
    <a href="/es/teams/t3">Con idioma</a>
    <a href="/en/matches/m1">Con idioma</a>
    <a href="/privacy">No es ficha</a>
    <a href="https://example.com/compara">Externo</a>
  `,
});

describe('parseSitemapLocs', () => {
  it('extrae las loc de un sitemapindex y de un urlset', () => {
    const xml = `<?xml version="1.0"?>
      <sitemapindex>
        <sitemap><loc>${BASE}/sitemap/core.xml</loc></sitemap>
        <sitemap><loc> ${BASE}/sitemap/teams-0.xml </loc></sitemap>
      </sitemapindex>`;

    expect(parseSitemapLocs(xml)).toEqual([
      { url: `${BASE}/sitemap/core.xml` },
      { url: `${BASE}/sitemap/teams-0.xml` },
    ]);
  });

  it('conserva el lastmod cuando existe', () => {
    const xml = `<urlset><url>
      <loc>${BASE}/es/teams/t1</loc>
      <lastmod>2026-10-01T10:00:00.000Z</lastmod>
    </url></urlset>`;

    expect(parseSitemapLocs(xml)).toEqual([
      { url: `${BASE}/es/teams/t1`, lastModified: '2026-10-01T10:00:00.000Z' },
    ]);
  });

  it('ignora locs vacías', () => {
    expect(parseSitemapLocs('<urlset><url><loc> </loc></url></urlset>')).toEqual([]);
  });
});

describe('entityFromPathname', () => {
  it('reconoce fichas con y sin idioma', () => {
    expect(entityFromPathname('/es/competitions/c1')).toEqual({ type: 'competition', locale: 'es', id: 'c1' });
    expect(entityFromPathname('/teams/t1')).toEqual({ type: 'team', locale: null, id: 't1' });
    expect(entityFromPathname('/en/players/p1')).toEqual({ type: 'player', locale: 'en', id: 'p1' });
    expect(entityFromPathname('/fr/matches/m1')).toEqual({ type: 'match', locale: 'fr', id: 'm1' });
  });

  it('marca home, listado y privacidad como core', () => {
    expect(entityFromPathname('/')).toEqual({ type: 'core', locale: null });
    expect(entityFromPathname('/es')).toEqual({ type: 'core', locale: 'es' });
    expect(entityFromPathname('/en/competitions')).toEqual({ type: 'core', locale: 'en' });
    expect(entityFromPathname('/pt/privacy')).toEqual({ type: 'core', locale: 'pt' });
  });

  it('descarta rutas que no son páginas del sitemap', () => {
    expect(entityFromPathname('/es/search')).toBeNull();
    expect(entityFromPathname('/api/health')).toBeNull();
    expect(entityFromPathname('/es/teams/t1/opengraph-image')).toBeNull();
  });
});

describe('sampleByType', () => {
  const urls = [
    ...['es', 'en', 'pt', 'fr', 'it'].flatMap((l) => [
      `${BASE}/${l}/competitions/c1`,
      `${BASE}/${l}/competitions/c2`,
      `${BASE}/${l}/teams/t1`,
      `${BASE}/${l}/teams/t2`,
      `${BASE}/${l}/players/p1`,
      `${BASE}/${l}/matches/m1`,
    ]),
  ];

  it('es determinista aunque cambie el orden de entrada', () => {
    expect(sampleByType(urls, 2)).toEqual(sampleByType([...urls].reverse(), 2));
  });

  it('toma `perType` por tipo y reparte cada tipo entre idiomas', () => {
    const sample = sampleByType(urls, 5);

    // 4 tipos (competición, equipo, jugador, partido) × 5 por tipo.
    expect(sample).toHaveLength(20);
    expect(new Set(sample).size).toBe(20);

    const byType = new Map<string, Set<string>>();
    for (const url of sample) {
      const type = new URL(url).pathname.split('/')[2];
      const locale = new URL(url).pathname.split('/')[1];
      const locales = byType.get(type) ?? new Set<string>();
      locales.add(locale);
      byType.set(type, locales);
    }

    for (const locales of byType.values()) expect(locales.size).toBe(5);
  });

  it('no devuelve más URLs de las disponibles', () => {
    const sample = sampleByType([`${BASE}/es/teams/t1`], 10);
    expect(sample).toEqual([`${BASE}/es/teams/t1`]);
  });
});

describe('parseUrlList', () => {
  it('ignora vacías, comentarios y espacios', () => {
    const list = parseUrlList(`
      # 404s de Search Console
      ${BASE}/en/matches/m1

      ${BASE}/es/teams/t1
    `);

    expect(list).toEqual([`${BASE}/en/matches/m1`, `${BASE}/es/teams/t1`]);
  });

  it('rechaza lo que no es http(s)', () => {
    expect(parseUrlList('ftp://x\nno-es-una-url\n/en/matches/m1')).toEqual([]);
  });
});

describe('withCacheBuster', () => {
  it('añade el parámetro sin romper los que ya hay', () => {
    expect(withCacheBuster(`${BASE}/es/teams/t1`, '123')).toBe(`${BASE}/es/teams/t1?cb=123`);
    expect(withCacheBuster(`${BASE}/es/teams/t1?season=s1`, '123')).toBe(
      `${BASE}/es/teams/t1?season=s1&cb=123`,
    );
  });
});

describe('stripCacheBuster', () => {
  it('quita solo el parámetro cb y conserva el resto de la query', () => {
    expect(stripCacheBuster(`${BASE}/es/teams/t1?season=s1&cb=99`)).toBe(
      `${BASE}/es/teams/t1?season=s1`,
    );
    expect(stripCacheBuster(`${BASE}/es/teams/t1?cb=99`)).toBe(`${BASE}/es/teams/t1`);
  });
});

describe('extractHead', () => {
  it('devuelve el contenido anterior a </head>', () => {
    const head = extractHead(GOOD_HTML);
    expect(head).toContain('<title>');
    expect(head).not.toContain('<h1>');
  });

  it('devuelve cadena vacía si no hay </head>', () => {
    expect(extractHead('<html><body><h1>Hola</h1></body></html>')).toBe('');
  });
});

describe('analyzeHtml', () => {
  it('encuentra title, canonical, hreflang y OG dentro del head', () => {
    const facts = analyzeHtml(GOOD_HTML);

    expect(facts.title).toBe('OK Liga | Stick Live');
    expect(facts.titleInHead).toBe(true);
    expect(facts.canonical).toBe(`${BASE}/es/competitions/c1`);
    expect(facts.canonicalInHead).toBe(true);
    expect(facts.hreflangs).toHaveLength(3);
    expect(facts.hasXDefault).toBe(true);
    expect(facts.ogUrl).toBe(`${BASE}/es/competitions/c1`);
    expect(facts.ogImage).toBe(`${BASE}/es/competitions/c1/opengraph-image`);
    expect(facts.lang).toBe('es');
  });

  it('detecta la metadata servida después de </head> (SEO-02)', () => {
    const streamed = `<html><head></head><body>
      <title>OK Liga | Stick Live</title>
      <link rel="canonical" href="${BASE}/es/competitions/c1">
    </body></html>`;
    const facts = analyzeHtml(streamed);

    expect(facts.title).toBe('OK Liga | Stick Live');
    expect(facts.titleInHead).toBe(false);
    expect(facts.canonicalInHead).toBe(false);
  });

  it('detecta noindex', () => {
    const facts = analyzeHtml(
      html({
        head: '<title>x</title><meta name="robots" content="noindex, follow">',
        body: '',
      }),
    );

    expect(facts.robots).toBe('noindex, follow');
    expect(facts.noindex).toBe(true);
  });

  it('cuenta palabras visibles sin script ni style', () => {
    const facts = analyzeHtml(
      html({
        head: '<title>x</title>',
        body: '<h1>OK Liga</h1><p>Hola&nbsp;mundo &amp; adiós</p><script>var x = 1;</script><style>.a{}</style>',
      }),
    );

    expect(facts.wordCount).toBe(5);
  });

  it('cuenta los enlaces internos a fichas que no llevan idioma', () => {
    expect(analyzeHtml(GOOD_HTML).internalLinksWithoutLocale).toBe(2);
  });

  it('extrae los tipos de JSON-LD, incluidos los de @graph', () => {
    expect(analyzeHtml(GOOD_HTML).jsonLdTypes).toEqual(['SportsEvent', 'BreadcrumbList']);
  });

  it('tolera JSON-LD roto sin romper el análisis', () => {
    const facts = analyzeHtml(
      html({ head: '<title>x</title><script type="application/ld+json">{roto</script>', body: '' }),
    );

    expect(facts.jsonLdTypes).toEqual([]);
    expect(facts.title).toBe('x');
  });
});

describe('canonicalMatches', () => {
  it('ignora query, mayúsculas y barra final', () => {
    expect(
      canonicalMatches(`${BASE}/es/teams/t1`, `${BASE}/es/teams/T1?season=s1`),
    ).toBe(true);
  });

  it('no da por bueno un canonical de otra URL', () => {
    expect(canonicalMatches(`${BASE}/en/teams/t1`, `${BASE}/es/teams/t1`)).toBe(false);
    expect(canonicalMatches(null, `${BASE}/es/teams/t1`)).toBe(false);
  });
});

function page(overrides: Partial<CrawlPage>): CrawlPage {
  return {
    url: `${BASE}/es/teams/t1`,
    type: 'team',
    locale: 'es',
    status: 200,
    finalUrl: `${BASE}/es/teams/t1`,
    redirects: [],
    contentType: 'text/html; charset=utf-8',
    cacheControl: null,
    cacheStatus: null,
    ttfbMs: 100,
    totalMs: 120,
    bytes: 1000,
    error: null,
    lang: 'es',
    title: 'CP Tordera | Stick Live',
    titleInHead: true,
    metaDescription: null,
    canonical: `${BASE}/es/teams/t1`,
    canonicalInHead: true,
    robots: null,
    noindex: false,
    hreflangs: [],
    hasXDefault: true,
    h1: 'CP Tordera',
    h1Count: 1,
    jsonLdTypes: ['SportsTeam'],
    wordCount: 200,
    ogUrl: `${BASE}/es/teams/t1`,
    ogImage: `${BASE}/es/teams/t1/opengraph-image`,
    internalLinks: 10,
    internalLinksWithoutLocale: 0,
    ...overrides,
  };
}

function report(pages: CrawlPage[]): CrawlReport {
  return {
    meta: { generatedAt: '2026-10-18T00:00:00.000Z', baseUrl: BASE, perType: 10, cacheBust: false },
    pages,
  };
}

describe('summarizePages', () => {
  it('resume estados, metadata y títulos duplicados', () => {
    const summary = summarizePages([
      page({}),
      page({
        url: `${BASE}/en/teams/t1`,
        locale: 'en',
        title: 'CP Tordera (EN) | Stick Live',
        titleInHead: false,
        canonicalInHead: false,
      }),
      page({ url: `${BASE}/es/teams/t2`, title: ' CP Tordera | Stick Live ', status: 404 }),
    ]);

    expect(summary.total).toBe(3);
    expect(summary.byStatus).toEqual({ 200: 2, 404: 1 });
    expect(summary.titleInHeadPct).toBe(67);
    expect(summary.canonicalInHeadPct).toBe(67);
    expect(summary.duplicateTitles).toHaveLength(1);
    expect(summary.duplicateTitles[0]).toHaveLength(2);
  });

  it('no cuenta como duplicado el mismo título en dos idiomas', () => {
    const summary = summarizePages([
      page({ url: `${BASE}/es/teams/t1`, locale: 'es', title: 'OK Liga | Stick Live' }),
      page({ url: `${BASE}/en/teams/t1`, locale: 'en', title: 'OK Liga | Stick Live' }),
    ]);

    expect(summary.duplicateTitles).toEqual([]);
  });

  it('cuenta noindex y enlaces sin idioma', () => {
    const summary = summarizePages([
      page({ noindex: true, internalLinksWithoutLocale: 3 }),
      page({ url: `${BASE}/es/teams/t2`, internalLinksWithoutLocale: 1 }),
    ]);

    expect(summary.noindex).toBe(1);
    expect(summary.internalLinksWithoutLocale).toBe(4);
  });
});

describe('diffReports', () => {
  it('detecta páginas nuevas, desaparecidas y campos cambiados', () => {
    const before = report([
      page({ titleInHead: false, canonicalInHead: false }),
      page({ url: `${BASE}/es/teams/t2` }),
    ]);
    const after = report([
      page({ titleInHead: true, canonicalInHead: true }),
      page({ url: `${BASE}/es/teams/t3` }),
    ]);

    const diff = diffReports(before, after);

    expect(diff.added).toEqual([`${BASE}/es/teams/t3`]);
    expect(diff.removed).toEqual([`${BASE}/es/teams/t2`]);
    expect(diff.changed).toEqual([
      { url: `${BASE}/es/teams/t1`, field: 'titleInHead', before: false, after: true },
      { url: `${BASE}/es/teams/t1`, field: 'canonicalInHead', before: false, after: true },
    ]);
  });

  it('no marca cambios si los valores son equivalentes', () => {
    const diff = diffReports(report([page({})]), report([page({})]));
    expect(diff).toEqual({ added: [], removed: [], changed: [] });
  });
});

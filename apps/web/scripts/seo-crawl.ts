/**
 * Rastreador SEO reproducible (F0-3 de `docs/AUDITORIA_SEO_2026-10-16.md`).
 *
 * Toma una muestra determinista del sitemap (o una lista de URLs), pide cada
 * página con el UA de Googlebot para smartphone y guarda un JSON con los campos
 * de §4. Dos ejecuciones se comparan con `--compare`, que imprime solo lo que
 * cambió.
 *
 * Uso:
 *   npx tsx apps/web/scripts/seo-crawl.ts
 *   npx tsx apps/web/scripts/seo-crawl.ts --per-type=20 --cache-bust
 *   npx tsx apps/web/scripts/seo-crawl.ts --urls=404s.txt --out=404s.json
 *   npx tsx apps/web/scripts/seo-crawl.ts --compare=seo-crawl-anterior.json
 *
 * No escribe nada más que el JSON de salida. No necesita credenciales.
 */
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  GOOGLEBOT_SMARTPHONE_UA,
  analyzeHtml,
  diffReports,
  entityFromPathname,
  parseSitemapLocs,
  parseUrlList,
  sampleByType,
  stripCacheBuster,
  summarizePages,
  withCacheBuster,
  type CrawlPage,
  type CrawlReport,
  type PageFacts,
  type SeoEntityType,
} from '../src/lib/seo-crawl';

interface Options {
  base: string;
  perType: number;
  out: string;
  urlsFile: string | null;
  compare: string | null;
  concurrency: number;
  timeoutMs: number;
  cacheBust: boolean;
  og: boolean;
  help: boolean;
}

const HELP = `Rastreador SEO de Stick Live (F0-3)

  --base=URL          Origen a rastrear (defecto: https://sticklive.eu)
  --per-type=N        Muestra por tipo de ficha (defecto: 10)
  --out=FILE          JSON de salida (defecto: seo-crawl-<fecha>.json)
  --urls=FILE         Rastrea esta lista de URLs en vez del sitemap
  --compare=FILE      Compara con una ejecución anterior y resume diferencias
  --concurrency=N     Peticiones en paralelo (defecto: 4)
  --timeout=MS        Timeout por petición (defecto: 20000)
  --cache-bust        Añade ?cb= para forzar render en frío
  --og                Comprueba también la imagen Open Graph de cada página
  --help              Esta ayuda

Ejemplos:
  npx tsx apps/web/scripts/seo-crawl.ts --per-type=10
  npx tsx apps/web/scripts/seo-crawl.ts --urls=404s.txt --out=404s.json

Sale con 2 si alguna URL del sitemap responde 4xx/5xx (el JSON se escribe igual).
`;

function parseArgs(argv: string[]): Options {
  const value = (name: string): string | null => {
    const prefix = `--${name}=`;
    const arg = argv.find((item) => item.startsWith(prefix));
    return arg ? arg.slice(prefix.length) : null;
  };
  const has = (name: string): boolean => argv.includes(`--${name}`);

  const number = (name: string, fallback: number): number => {
    const raw = value(name);
    if (raw === null) return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`--${name} debe ser un número positivo (recibido: ${raw})`);
    }
    return Math.floor(parsed);
  };

  return {
    base: (value('base') ?? 'https://sticklive.eu').replace(/\/+$/, ''),
    perType: number('per-type', 10),
    out: value('out') ?? `seo-crawl-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
    urlsFile: value('urls'),
    compare: value('compare'),
    concurrency: number('concurrency', 4),
    timeoutMs: number('timeout', 20_000),
    cacheBust: has('cache-bust'),
    og: has('og'),
    help: has('help'),
  };
}

function gitCommit(): string | null {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

async function fetchText(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { 'user-agent': GOOGLEBOT_SMARTPHONE_UA, accept: 'application/xml,text/xml,*/*' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

/** URLs de todas las secciones del sitemap, en orden estable. */
async function sitemapUrls(base: string, timeoutMs: number): Promise<string[]> {
  const indexUrl = `${base}/sitemap-index.xml`;
  const index = await fetchText(indexUrl, timeoutMs);
  const sections = parseSitemapLocs(index).map((entry) => new URL(entry.url, base).toString());
  if (sections.length === 0) throw new Error(`${indexUrl} no declara ninguna sección`);

  const urls: string[] = [];
  for (const section of sections) {
    const xml = await fetchText(section, timeoutMs);
    urls.push(...parseSitemapLocs(xml).map((entry) => entry.url));
  }
  return urls;
}

interface FetchResult {
  status: number;
  finalUrl: string;
  redirects: string[];
  contentType: string | null;
  cacheControl: string | null;
  cacheStatus: string | null;
  ttfbMs: number;
  totalMs: number;
  bytes: number;
  html: string;
  error: string | null;
}

async function fetchPage(url: string, timeoutMs: number): Promise<FetchResult> {
  let current = url;
  const redirects: string[] = [];
  const started = performance.now();

  for (let hop = 0; hop <= 3; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const before = performance.now();
    try {
      const response = await fetch(current, {
        headers: { 'user-agent': GOOGLEBOT_SMARTPHONE_UA, accept: 'text/html,*/*' },
        redirect: 'manual',
        signal: controller.signal,
      });
      const ttfbMs = Math.round(performance.now() - before);
      const location = response.headers.get('location');

      if (response.status >= 300 && response.status < 400 && location && hop < 3) {
        const next = new URL(location, current).toString();
        redirects.push(next);
        current = next;
        continue;
      }

      const contentType = response.headers.get('content-type');
      const html = contentType?.includes('text/html') ? await response.text() : '';
      return {
        status: response.status,
        finalUrl: current,
        redirects,
        contentType,
        cacheControl: response.headers.get('cache-control'),
        cacheStatus:
          response.headers.get('x-nextjs-cache') ??
          response.headers.get('cf-cache-status') ??
          null,
        ttfbMs,
        totalMs: Math.round(performance.now() - started),
        bytes: Buffer.byteLength(html),
        html,
        error: null,
      };
    } catch (error) {
      return {
        status: 0,
        finalUrl: current,
        redirects,
        contentType: null,
        cacheControl: null,
        cacheStatus: null,
        ttfbMs: 0,
        totalMs: Math.round(performance.now() - started),
        bytes: 0,
        html: '',
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(`demasiadas redirecciones desde ${url}`);
}

const EMPTY_FACTS: PageFacts = {
  lang: null,
  title: null,
  titleInHead: false,
  metaDescription: null,
  canonical: null,
  canonicalInHead: false,
  robots: null,
  noindex: false,
  hreflangs: [],
  hasXDefault: false,
  h1: null,
  h1Count: 0,
  jsonLdTypes: [],
  wordCount: 0,
  ogUrl: null,
  ogImage: null,
  internalLinks: 0,
  internalLinksWithoutLocale: 0,
};

interface OgResult {
  ogStatus: number | null;
  ogContentType: string | null;
  ogMs: number | null;
  ogBytes: number | null;
}

async function checkOg(url: string | null, timeoutMs: number): Promise<OgResult> {
  if (!url) return { ogStatus: null, ogContentType: null, ogMs: null, ogBytes: null };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const before = performance.now();
  try {
    const response = await fetch(url, {
      headers: { 'user-agent': GOOGLEBOT_SMARTPHONE_UA },
      signal: controller.signal,
    });
    const body = await response.arrayBuffer();
    return {
      ogStatus: response.status,
      ogContentType: response.headers.get('content-type'),
      ogMs: Math.round(performance.now() - before),
      ogBytes: body.byteLength,
    };
  } catch {
    return { ogStatus: 0, ogContentType: null, ogMs: Math.round(performance.now() - before), ogBytes: null };
  } finally {
    clearTimeout(timer);
  }
}

async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  });

  await Promise.all(workers);
  return results;
}

async function crawlOne(url: string, options: Options, index: number): Promise<CrawlPage> {
  const entity = entityFromPathname(new URL(url).pathname);
  const requested = options.cacheBust ? withCacheBuster(url, `${Date.now()}${index}`) : url;
  const result = await fetchPage(requested, options.timeoutMs);
  const facts = result.html ? analyzeHtml(result.html) : EMPTY_FACTS;
  const og = options.og ? await checkOg(facts.ogImage, options.timeoutMs) : null;

  return {
    url,
    type: (entity?.type ?? 'other') as SeoEntityType | 'other',
    locale: entity?.locale ?? null,
    status: result.status,
    // Sin el `cb`: el informe debe ser comparable entre ejecuciones.
    finalUrl: options.cacheBust ? stripCacheBuster(result.finalUrl) : result.finalUrl,
    redirects: options.cacheBust ? result.redirects.map(stripCacheBuster) : result.redirects,
    contentType: result.contentType,
    cacheControl: result.cacheControl,
    cacheStatus: result.cacheStatus,
    ttfbMs: result.ttfbMs,
    totalMs: result.totalMs,
    bytes: result.bytes,
    error: result.error,
    ...facts,
    ...(og ?? {}),
  };
}

function printSummary(report: CrawlReport): void {
  const summary = summarizePages(report.pages);
  console.log(`\nMuestra: ${summary.total} páginas`);
  console.log(`  Por tipo: ${Object.entries(summary.byType).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  console.log(`  Por estado: ${Object.entries(summary.byStatus).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  console.log(`  title en <head>: ${summary.titleInHeadPct}%`);
  console.log(`  canonical presente: ${summary.canonicalPct}% · en <head>: ${summary.canonicalInHeadPct}%`);
  console.log(`  noindex: ${summary.noindex}`);
  console.log(`  enlaces internos sin idioma: ${summary.internalLinksWithoutLocale}`);
  console.log(`  TTFB medio: ${summary.avgTtfbMs} ms`);

  if (summary.duplicateTitles.length > 0) {
    console.log(`  títulos duplicados: ${summary.duplicateTitles.length} grupos`);
    for (const group of summary.duplicateTitles.slice(0, 5)) {
      console.log(`    ${group.length}× ${group.slice(0, 3).join(', ')}`);
    }
  }

  const errors = report.pages.filter((page) => page.error);
  if (errors.length > 0) {
    console.log(`  errores de red: ${errors.length}`);
    for (const page of errors.slice(0, 5)) console.log(`    ${page.url}: ${page.error}`);
  }
}

function printDiff(previous: CrawlReport, current: CrawlReport): void {
  const diff = diffReports(previous, current);
  console.log(`\nDiferencias contra ${previous.meta.generatedAt}`);
  console.log(`  nuevas: ${diff.added.length} · desaparecidas: ${diff.removed.length} · cambios: ${diff.changed.length}`);

  for (const url of diff.added.slice(0, 20)) console.log(`  + ${url}`);
  for (const url of diff.removed.slice(0, 20)) console.log(`  - ${url}`);
  for (const change of diff.changed.slice(0, 80)) {
    console.log(`  ~ ${change.url} · ${change.field}: ${JSON.stringify(change.before)} → ${JSON.stringify(change.after)}`);
  }
  if (diff.changed.length > 80) console.log(`  … y ${diff.changed.length - 80} cambios más`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(HELP);
    return;
  }

  let targets: string[];
  let mode: 'sitemap' | 'urls' = 'sitemap';

  if (options.urlsFile) {
    mode = 'urls';
    targets = parseUrlList(await readFile(resolve(options.urlsFile), 'utf8'));
    if (targets.length === 0) throw new Error(`${options.urlsFile} no contiene URLs http(s)`);
  } else {
    const all = await sitemapUrls(options.base, options.timeoutMs);
    targets = sampleByType(all, options.perType);
    if (targets.length === 0) throw new Error('el sitemap no devolvió URLs');
    console.log(`Sitemap: ${all.length} URLs · muestra: ${targets.length}`);
  }

  console.log(`Rastreando ${targets.length} URLs con UA de Googlebot para smartphone…`);
  const pages = await mapPool(targets, options.concurrency, (url, index) => crawlOne(url, options, index));

  const report: CrawlReport = {
    meta: {
      generatedAt: new Date().toISOString(),
      baseUrl: options.base,
      perType: options.perType,
      cacheBust: options.cacheBust,
      mode,
      node: process.version,
      commit: gitCommit(),
      count: pages.length,
    },
    pages,
  };

  const outPath = resolve(options.out);
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`\nJSON: ${outPath}`);

  printSummary(report);

  if (options.compare) {
    const previous = JSON.parse(await readFile(resolve(options.compare), 'utf8')) as CrawlReport;
    if (!Array.isArray(previous.pages)) throw new Error(`${options.compare} no es un informe de seo-crawl`);
    printDiff(previous, report);
  }

  // Un error de red aislado no invalida la muestra, pero sí debe verse.
  if (pages.every((page) => page.status === 0)) {
    throw new Error('todas las peticiones fallaron: revisa la red o --base');
  }

  // El fichero se escribe aunque haya 404: son parte del diagnóstico (F2-7).
  if (mode === 'sitemap' && pages.some((page) => page.status >= 400)) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(`\nseo-crawl: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

/**
 * Piezas puras del rastreador SEO (F0-3 de `docs/AUDITORIA_SEO_2026-10-16.md`).
 *
 * El CLI vive en `apps/web/scripts/seo-crawl.ts`; aquí está todo lo que se puede
 * probar sin red: parseo de sitemaps, muestreo determinista, extracción de los
 * campos de §4 del HTML y comparación de dos ejecuciones.
 */
import { SUPPORTED_LOCALES } from './locales';

/** UA de Googlebot para smartphone: el que usa Search Console al inspeccionar. */
export const GOOGLEBOT_SMARTPHONE_UA =
  'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36 ' +
  '(compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

export type SeoEntityType = 'core' | 'competition' | 'team' | 'player' | 'match';

export interface SitemapEntry {
  url: string;
  lastModified?: string;
}

export interface PageFacts {
  lang: string | null;
  title: string | null;
  titleInHead: boolean;
  metaDescription: string | null;
  canonical: string | null;
  canonicalInHead: boolean;
  robots: string | null;
  noindex: boolean;
  hreflangs: Array<{ hreflang: string; href: string }>;
  hasXDefault: boolean;
  h1: string | null;
  h1Count: number;
  jsonLdTypes: string[];
  wordCount: number;
  ogUrl: string | null;
  ogImage: string | null;
  internalLinks: number;
  internalLinksWithoutLocale: number;
}

export interface CrawlPage extends PageFacts {
  url: string;
  type: SeoEntityType | 'other';
  locale: string | null;
  status: number;
  finalUrl: string;
  redirects: string[];
  contentType: string | null;
  cacheControl: string | null;
  /** Cabecera de caché de Next: HIT/MISS/STALE, si está presente. */
  cacheStatus: string | null;
  ttfbMs: number;
  totalMs: number;
  bytes: number;
  error: string | null;
  /** Solo con `--og`: estado y coste de la imagen Open Graph de la página. */
  ogStatus?: number | null;
  ogContentType?: string | null;
  ogMs?: number | null;
  ogBytes?: number | null;
}

export interface CrawlReport {
  meta: {
    generatedAt: string;
    baseUrl: string;
    perType: number;
    cacheBust: boolean;
    [key: string]: unknown;
  };
  pages: CrawlPage[];
}

export interface CrawlDiff {
  added: string[];
  removed: string[];
  changed: Array<{ url: string; field: string; before: unknown; after: unknown }>;
}

const ENTITY_SEGMENT: Record<string, Exclude<SeoEntityType, 'core'>> = {
  competitions: 'competition',
  teams: 'team',
  players: 'player',
  matches: 'match',
};

const LOCALES: readonly string[] = SUPPORTED_LOCALES;

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function attribute(tag: string, name: string): string | null {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const match = re.exec(tag);
  if (!match) return null;
  return decodeEntities(match[1] ?? match[2] ?? match[3] ?? '');
}

function tags(html: string, name: string): string[] {
  const re = new RegExp(`<${name}\\b[^>]*>`, 'gi');
  return html.match(re) ?? [];
}

/**
 * `<loc>` de un `sitemapindex` o de un `urlset`. Acepta espacios alrededor y
 * conserva el `lastmod` cuando está en el mismo bloque.
 */
export function parseSitemapLocs(xml: string): SitemapEntry[] {
  const out: SitemapEntry[] = [];
  const blocks = xml.match(/<(?:url|sitemap)\b[\s\S]*?<\/(?:url|sitemap)>/gi) ?? [];

  for (const block of blocks) {
    const loc = /<loc>\s*([\s\S]*?)\s*<\/loc>/i.exec(block);
    if (!loc) continue;
    const url = decodeEntities(loc[1].trim());
    if (!url) continue;
    const lastmod = /<lastmod>\s*([\s\S]*?)\s*<\/lastmod>/i.exec(block);
    out.push(lastmod ? { url, lastModified: lastmod[1].trim() } : { url });
  }

  if (out.length > 0) return out;

  // Tolerancia con XML sin bloques <url>/<sitemap> bien cerrados.
  for (const loc of xml.matchAll(/<loc>\s*([\s\S]*?)\s*<\/loc>/gi)) {
    const url = decodeEntities(loc[1].trim());
    if (url) out.push({ url });
  }
  return out;
}

/** Tipo de página y locale a partir de la ruta (sin depender del host). */
export function entityFromPathname(
  pathname: string,
): { type: SeoEntityType; locale: string | null; id?: string } | null {
  const segments = pathname.split('?')[0].split('#')[0].split('/').filter(Boolean);
  let locale: string | null = null;

  if (segments.length > 0 && LOCALES.includes(segments[0])) {
    locale = segments.shift() as string;
  }
  if (segments.length === 0) return { type: 'core', locale };
  if (segments.length === 1 && (segments[0] === 'competitions' || segments[0] === 'privacy')) {
    return { type: 'core', locale };
  }
  if (segments.length === 2) {
    const type = ENTITY_SEGMENT[segments[0]];
    if (type && segments[1]) return { type, locale, id: segments[1] };
  }
  return null;
}

function pickEvenly<T>(items: T[], count: number): T[] {
  if (count >= items.length) return [...items];
  if (count <= 0) return [];
  if (count === 1) return [items[Math.floor((items.length - 1) / 2)]];

  const picked = new Set<number>();
  for (let i = 0; i < count; i++) {
    picked.add(Math.round((i * (items.length - 1)) / (count - 1)));
  }
  return [...picked].sort((a, b) => a - b).map((index) => items[index]);
}

/**
 * Muestra determinista por tipo y repartida entre idiomas. Ordena la entrada,
 * así que el mismo sitemap produce siempre la misma muestra aunque la API
 * devuelva las secciones en otro orden.
 */
export function sampleByType(urls: string[], perType: number): string[] {
  const sorted = [...new Set(urls)].sort();
  const byType = new Map<SeoEntityType | 'other', Map<string, string[]>>();

  for (const url of sorted) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      continue;
    }
    const entity = entityFromPathname(parsed.pathname);
    const type = entity?.type ?? 'other';
    const locale = entity?.locale ?? '';
    const locales = byType.get(type) ?? new Map<string, string[]>();
    const list = locales.get(locale) ?? [];
    list.push(url);
    locales.set(locale, list);
    byType.set(type, locales);
  }

  const out: string[] = [];
  for (const locales of byType.values()) {
    const codes = [...locales.keys()].sort();
    if (codes.length === 0) continue;
    const base = Math.floor(perType / codes.length);
    const remainder = perType % codes.length;

    codes.forEach((code, index) => {
      const take = base + (index < remainder ? 1 : 0);
      if (take <= 0) return;
      out.push(...pickEvenly(locales.get(code) ?? [], take));
    });
  }
  return out;
}

/** Texto anterior a `</head>`; vacío si el documento no cierra el head (SEO-02). */
export function extractHead(html: string): string {
  const end = html.indexOf('</head>');
  return end >= 0 ? html.slice(0, end) : '';
}

function visibleText(html: string): string {
  const bodyStart = html.search(/<body\b/i);
  const body = bodyStart >= 0 ? html.slice(bodyStart) : html;
  return body
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<template\b[\s\S]*?<\/template>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ');
}

function stripTags(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function jsonLdTypes(html: string): string[] {
  const types: string[] = [];
  const scripts = html.matchAll(
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );

  const collect = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(collect);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    const type = record['@type'];
    if (typeof type === 'string') types.push(type);
    if (Array.isArray(type)) {
      for (const item of type) if (typeof item === 'string') types.push(item);
    }
    collect(record['@graph']);
  };

  for (const script of scripts) {
    try {
      collect(JSON.parse(script[1]));
    } catch {
      // JSON-LD roto: no invalida el resto del análisis.
    }
  }
  return [...new Set(types)];
}

/** Campos de §4 que se pueden extraer del HTML, sin red. */
export function analyzeHtml(html: string): PageFacts {
  const head = extractHead(html);
  const headTags = {
    title: tags(head, 'title'),
    link: tags(head, 'link'),
    meta: tags(head, 'meta'),
  };
  const allLinks = tags(html, 'link');
  const allMeta = tags(html, 'meta');

  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? stripTags(titleMatch[1]) : null;

  const canonicalTag = allLinks.find((tag) => (attribute(tag, 'rel') ?? '').toLowerCase() === 'canonical') ?? null;
  const canonical = canonicalTag ? attribute(canonicalTag, 'href') : null;
  const canonicalInHead = headTags.link.some((tag) => (attribute(tag, 'rel') ?? '').toLowerCase() === 'canonical');

  const robotsTag = allMeta.find((tag) => (attribute(tag, 'name') ?? '').toLowerCase() === 'robots') ?? null;
  const robots = robotsTag ? attribute(robotsTag, 'content') : null;

  const hreflangs = allLinks
    .filter((tag) => (attribute(tag, 'rel') ?? '').toLowerCase() === 'alternate' && attribute(tag, 'hreflang'))
    .map((tag) => ({ hreflang: attribute(tag, 'hreflang') as string, href: attribute(tag, 'href') ?? '' }));

  const h1Tags = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi) ?? [];

  const ogMeta = (property: string): string | null => {
    const tag = allMeta.find((meta) => {
      const key = (attribute(meta, 'property') ?? attribute(meta, 'name') ?? '').toLowerCase();
      return key === property;
    });
    return tag ? attribute(tag, 'content') : null;
  };

  const descriptionTag = allMeta.find((tag) => (attribute(tag, 'name') ?? '').toLowerCase() === 'description') ?? null;

  let internalLinks = 0;
  let internalLinksWithoutLocale = 0;
  for (const anchor of tags(html, 'a')) {
    const href = attribute(anchor, 'href');
    if (!href) continue;
    let path: string | null = null;
    if (href.startsWith('/')) {
      path = href;
    } else {
      try {
        const parsed = new URL(href);
        if (parsed.host === 'sticklive.eu' || parsed.host === 'www.sticklive.eu') path = parsed.pathname;
      } catch {
        // href no absoluto ni resoluble: no es un enlace interno.
      }
    }
    if (path === null) continue;
    internalLinks++;
    if (/^\/(?:competitions|teams|players|matches)(?:\/|$)/i.test(path.split('?')[0])) {
      internalLinksWithoutLocale++;
    }
  }

  const htmlTag = tags(html, 'html')[0] ?? null;
  const words = visibleText(html).match(/[\p{L}\p{N}]+/gu) ?? [];

  return {
    lang: htmlTag ? attribute(htmlTag, 'lang') : null,
    title,
    titleInHead: headTags.title.length > 0,
    metaDescription: descriptionTag ? attribute(descriptionTag, 'content') : null,
    canonical,
    canonicalInHead,
    robots,
    noindex: /noindex/i.test(robots ?? ''),
    hreflangs,
    hasXDefault: hreflangs.some((entry) => entry.hreflang.toLowerCase() === 'x-default'),
    h1: h1Tags[0] ? stripTags(h1Tags[0].replace(/^<h1\b[^>]*>/i, '')) : null,
    h1Count: h1Tags.length,
    jsonLdTypes: jsonLdTypes(html),
    wordCount: words.length,
    ogUrl: ogMeta('og:url'),
    ogImage: ogMeta('og:image'),
    internalLinks,
    internalLinksWithoutLocale,
  };
}

function normalizeForCompare(raw: string): string {
  try {
    const url = new URL(raw);
    url.hash = '';
    url.search = '';
    url.hostname = url.hostname.toLowerCase();
    const path = url.pathname.replace(/\/+$/, '').toLowerCase() || '/';
    return `${url.protocol}//${url.host}${path}`;
  } catch {
    return raw.trim().replace(/\/+$/, '').toLowerCase();
  }
}

/** ¿El canonical apunta a la página pedida, ignorando query, mayúsculas y barra final? */
export function canonicalMatches(canonical: string | null, pageUrl: string): boolean {
  if (!canonical) return false;
  return normalizeForCompare(canonical) === normalizeForCompare(pageUrl);
}

export interface CrawlSummary {
  total: number;
  byType: Record<string, number>;
  byStatus: Record<string, number>;
  titleInHeadPct: number;
  canonicalInHeadPct: number;
  canonicalPct: number;
  noindex: number;
  internalLinksWithoutLocale: number;
  avgTtfbMs: number;
  duplicateTitles: string[][];
}

function percentage(part: number, total: number): number {
  return total === 0 ? 0 : Math.round((part * 100) / total);
}

export function summarizePages(pages: CrawlPage[]): CrawlSummary {
  const byType: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  const titles = new Map<string, string[]>();

  for (const page of pages) {
    byType[page.type] = (byType[page.type] ?? 0) + 1;
    byStatus[String(page.status)] = (byStatus[String(page.status)] ?? 0) + 1;
    const title = (page.title ?? '').replace(/\s+/g, ' ').trim();
    if (title) {
      // El mismo título en dos idiomas es lo esperado (los nombres propios no
      // se traducen). Duplicado de verdad es dentro del mismo idioma.
      const key = `${page.locale ?? ''}\u0000${title}`;
      const urls = titles.get(key) ?? [];
      urls.push(page.url);
      titles.set(key, urls);
    }
  }

  const total = pages.length;
  return {
    total,
    byType,
    byStatus,
    titleInHeadPct: percentage(pages.filter((page) => page.titleInHead).length, total),
    canonicalInHeadPct: percentage(pages.filter((page) => page.canonicalInHead).length, total),
    canonicalPct: percentage(pages.filter((page) => Boolean(page.canonical)).length, total),
    noindex: pages.filter((page) => page.noindex).length,
    internalLinksWithoutLocale: pages.reduce((sum, page) => sum + page.internalLinksWithoutLocale, 0),
    avgTtfbMs:
      total === 0 ? 0 : Math.round(pages.reduce((sum, page) => sum + page.ttfbMs, 0) / total),
    duplicateTitles: [...titles.values()].filter((urls) => urls.length > 1).sort((a, b) => b.length - a.length),
  };
}

const DIFF_FIELDS = [
  'status',
  'finalUrl',
  'title',
  'titleInHead',
  'canonical',
  'canonicalInHead',
  'noindex',
  'robots',
  'h1',
  'h1Count',
  'jsonLdTypes',
  'wordCount',
  'internalLinksWithoutLocale',
  'ogUrl',
  'ogImage',
] as const;

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a) === JSON.stringify(b);
  return a === b;
}

/** Diferencia entre dos ejecuciones, por URL y por campo de §4. */
export function diffReports(before: CrawlReport, after: CrawlReport): CrawlDiff {
  const beforeByUrl = new Map(before.pages.map((page) => [page.url, page]));
  const afterByUrl = new Map(after.pages.map((page) => [page.url, page]));

  const added = [...afterByUrl.keys()].filter((url) => !beforeByUrl.has(url)).sort();
  const removed = [...beforeByUrl.keys()].filter((url) => !afterByUrl.has(url)).sort();
  const changed: CrawlDiff['changed'] = [];

  for (const url of [...beforeByUrl.keys()].filter((key) => afterByUrl.has(key)).sort()) {
    const oldPage = beforeByUrl.get(url) as CrawlPage;
    const newPage = afterByUrl.get(url) as CrawlPage;
    for (const field of DIFF_FIELDS) {
      const oldValue = oldPage[field];
      const newValue = newPage[field];
      if (!sameValue(oldValue, newValue)) {
        changed.push({ url, field, before: oldValue, after: newValue });
      }
    }
  }

  return { added, removed, changed };
}

/** URLs de un fichero de texto (una por línea, `#` para comentarios). */
export function parseUrlList(text: string): string[] {
  const urls: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (!/^https?:\/\//i.test(line)) continue;
    try {
      urls.push(new URL(line).toString());
    } catch {
      // Línea que no es una URL válida: se ignora.
    }
  }
  return [...new Set(urls)];
}

/** Añade `?cb=` para forzar un render en frío sin perder los parámetros existentes. */
export function withCacheBuster(url: string, token: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set('cb', token);
  return parsed.toString();
}

/** Quita el `cb` de una URL ya rastreada, para que dos ejecuciones sean comparables. */
export function stripCacheBuster(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.delete('cb');
  return parsed.toString();
}

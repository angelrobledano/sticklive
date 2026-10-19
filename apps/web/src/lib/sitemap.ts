/**
 * Construcción del sitemap multiidioma (#169).
 *
 * Un único `sitemap.xml` se trunca en silencio al pasar de 50.000 URLs (límite
 * de Google) y el bloque de jugadores crece sin techo. Con `generateSitemaps()`
 * se emite una sección por tipo de entidad y, dentro de cada tipo, trozos de
 * `SITEMAP_SECTION_SIZE` entradas: con 5 locales por entrada, cada fichero queda
 * holgadamente por debajo del límite.
 *
 * Lógica pura para poder testearla sin Next ni red.
 */

import { FALLBACK_LOCALE } from '@/lib/locales';

/** Fecha de una entidad en el sitemap (ISO string o Date ya parseado). */
export type SitemapDate = string | Date | null | undefined;

/**
 * Entidad del sitemap con sus fechas de DATOS (#337). La API puede devolver
 * solo el `id` (compatibilidad) o el objeto con las fechas disponibles:
 * `updatedAt` (última escritura), `finishedAt`/`scheduledAt` (partidos).
 */
export interface SitemapItem {
  id: string;
  updatedAt?: SitemapDate;
  finishedAt?: SitemapDate;
  scheduledAt?: SitemapDate;
}

/** Id suelto (forma antigua) o entidad con fechas. */
export type SitemapId = string | SitemapItem;

export interface SitemapIds {
  competitions: SitemapId[];
  teams: SitemapId[];
  players: SitemapId[];
  /** Temporadas cerradas con página permanente (F4-5). */
  seasons: SitemapId[];
  matches: SitemapId[];
}

/** Entradas por sección. ×5 locales = 40.000 < 50.000 (límite de Google). */
export const SITEMAP_SECTION_SIZE = 8_000;

export interface SitemapEntry {
  /** Ruta sin prefijo de idioma (p. ej. `/teams/<id>`). */
  path: string;
  /**
   * `lastmod` derivado de los datos (#337). `undefined` en `core` o cuando la
   * entidad no trae fecha: mejor omitirlo que emitir una fecha de generación
   * idéntica para todas las URLs.
   */
  lastModified?: Date;
}

/** Id de una entidad, sea string (forma antigua) u objeto con fechas. */
export function sitemapItemId(item: SitemapId): string {
  return typeof item === 'string' ? item : item.id;
}

/**
 * `lastmod` de una entidad a partir de sus DATOS (#337), nunca de `new Date()`:
 * se prefiere `updatedAt` (última modificación real del registro) y, si no
 * llega, se cae a `finishedAt` → `scheduledAt` (partidos). Devuelve `null` si
 * no hay ninguna fecha válida; el llamante debe omitir entonces el lastmod.
 */
export function sitemapLastModified(item: SitemapId): Date | null {
  if (typeof item === 'string') return null;
  for (const value of [item.updatedAt, item.finishedAt, item.scheduledAt]) {
    if (!value) continue;
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return null;
}

const ENTITY_META: Record<string, { prefix: string }> = {
  competitions: { prefix: '/competitions' },
  teams: { prefix: '/teams' },
  players: { prefix: '/players' },
  seasons: { prefix: '/seasons' },
};

/**
 * Separa los partidos en recientes (jugados o en directo: -60 días) y próximos
 * (+14 días). La API ya devuelve solo esa ventana; aquí se reparte para que
 * Search Console distinga en su informe cuánto se indexa de cada grupo (F2-3).
 */
function splitMatches(matches: SitemapIds['matches'] | undefined): {
  recent: SitemapId[];
  upcoming: SitemapId[];
} {
  const now = Date.now();
  const recent: SitemapId[] = [];
  const upcoming: SitemapId[] = [];
  for (const item of matches ?? []) {
    if (typeof item === 'string') {
      recent.push(item);
      continue;
    }
    const finished = item.finishedAt ? new Date(item.finishedAt).getTime() : null;
    const scheduled = item.scheduledAt ? new Date(item.scheduledAt).getTime() : null;
    const isRecent = finished !== null || (scheduled !== null && scheduled <= now);
    (isRecent ? recent : upcoming).push(item);
  }
  return { recent, upcoming };
}

function sectionIdsFor(name: string, list: SitemapId[]): string[] {
  if (list.length === 0) return [];
  const chunks = Math.ceil(list.length / SITEMAP_SECTION_SIZE);
  return Array.from({ length: chunks }, (_, i) => `${name}-${i}`);
}

/** Ids de sección para `generateSitemaps`: `core` + un trozo por tipo con datos. */
export function sitemapSectionIds(ids: SitemapIds): string[] {
  const out: string[] = ['core'];
  for (const name of Object.keys(ENTITY_META)) {
    out.push(...sectionIdsFor(name, ids[name as keyof SitemapIds] ?? []));
  }
  const { recent, upcoming } = splitMatches(ids.matches);
  out.push(...sectionIdsFor('matches-recent', recent), ...sectionIdsFor('matches-upcoming', upcoming));
  return out;
}

/** Entradas (sin prefijo de idioma) de una sección/trozo. */
export function sitemapEntries(section: string, ids: SitemapIds): SitemapEntry[] {
  if (section === 'core') {
    return [
      { path: '' },
      { path: '/competitions' },
      { path: '/about' },
      { path: '/contact' },
      { path: '/legal' },
      // Página pública indexable que faltaba en el sitemap.
      { path: '/privacy' },
    ];
  }

  const dash = section.lastIndexOf('-');
  if (dash < 0) return [];
  const name = section.slice(0, dash);

  if (name === 'matches-recent' || name === 'matches-upcoming') {
    const chunk = Number(section.slice(dash + 1)) || 0;
    const { recent, upcoming } = splitMatches(ids.matches);
    const list = name === 'matches-recent' ? recent : upcoming;
    const slice = list.slice(chunk * SITEMAP_SECTION_SIZE, (chunk + 1) * SITEMAP_SECTION_SIZE);
    return slice.map((item) => {
      const entry: SitemapEntry = { path: `/matches/${sitemapItemId(item)}` };
      const lastModified = sitemapLastModified(item);
      if (lastModified) entry.lastModified = lastModified;
      return entry;
    });
  }

  const meta = ENTITY_META[name];
  if (!meta) return [];

  const chunk = Number(section.slice(dash + 1)) || 0;
  const list = ids[name as keyof SitemapIds] ?? [];
  const slice = list.slice(chunk * SITEMAP_SECTION_SIZE, (chunk + 1) * SITEMAP_SECTION_SIZE);
  return slice.map((item) => {
    const entry: SitemapEntry = {
      path: `${meta.prefix}/${sitemapItemId(item)}`,
    };
    const lastModified = sitemapLastModified(item);
    if (lastModified) entry.lastModified = lastModified;
    return entry;
  });
}

/**
 * Índice de sitemaps (`sitemapindex`) que declara todas las secciones.
 *
 * Con `generateSitemaps()` Next 16 publica cada sección en `/sitemap/<id>.xml`
 * y **no genera ningún índice** (las mapea a `/sitemap/[__metadata_id__]`), así
 * que un `/sitemap.xml` a secas devuelve 404. Sin este índice, Google no
 * descubre ninguna sección y el `Sitemap:` de `robots.txt` apunta a un 404.
 *
 * Los ids vienen de `sitemapSectionIds` (constantes propias: `core` y
 * `<tipo>-<trozo>`), no de datos de usuario, así que no hay nada que escapar.
 */
export function sitemapIndexXml(sectionIds: string[], siteUrl: string): string {
  const entries = sectionIds
    .map((id) => `  <sitemap><loc>${siteUrl}/sitemap/${id}.xml</loc></sitemap>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</sitemapindex>\n`;
}

/**
 * Bloque `hreflang` de una URL del sitemap.
 *
 * Debe coincidir con el que sirve el propio HTML (`localeAlternates`): Google
 * contrasta las dos fuentes y un `x-default` que solo apareciera en una de
 * ellas es una señal contradictoria. El idioma por defecto es español, el
 * mercado principal del producto.
 */
export function sitemapLanguages(
  path: string,
  siteUrl: string,
  locales: readonly string[],
): Record<string, string> {
  const languages: Record<string, string> = {};
  for (const locale of locales) languages[locale] = `${siteUrl}/${locale}${path}`;
  languages['x-default'] = `${siteUrl}/${FALLBACK_LOCALE}${path}`;
  return languages;
}

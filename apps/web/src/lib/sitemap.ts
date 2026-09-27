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

export interface SitemapIds {
  competitions: string[];
  teams: string[];
  players: string[];
  matches: string[];
}

/** Entradas por sección. ×5 locales = 40.000 < 50.000 (límite de Google). */
export const SITEMAP_SECTION_SIZE = 8_000;

export type SitemapChangeFrequency = 'hourly' | 'daily' | 'weekly';

export interface SitemapEntry {
  /** Ruta sin prefijo de idioma (p. ej. `/teams/<id>`). */
  path: string;
  priority: number;
  changeFrequency: SitemapChangeFrequency;
}

const ENTITY_META: Record<string, { prefix: string; priority: number; changeFrequency: SitemapChangeFrequency }> = {
  competitions: { prefix: '/competitions', priority: 0.8, changeFrequency: 'daily' },
  teams:        { prefix: '/teams',        priority: 0.7, changeFrequency: 'daily' },
  players:      { prefix: '/players',      priority: 0.6, changeFrequency: 'weekly' },
  matches:      { prefix: '/matches',      priority: 0.6, changeFrequency: 'hourly' },
};

/** Ids de sección para `generateSitemaps`: `core` + un trozo por tipo con datos. */
export function sitemapSectionIds(ids: SitemapIds): string[] {
  const out: string[] = ['core'];
  for (const name of Object.keys(ENTITY_META)) {
    const list = ids[name as keyof SitemapIds];
    if (!list || list.length === 0) continue;
    const chunks = Math.ceil(list.length / SITEMAP_SECTION_SIZE);
    for (let i = 0; i < chunks; i++) out.push(`${name}-${i}`);
  }
  return out;
}

/** Entradas (sin prefijo de idioma) de una sección/trozo. */
export function sitemapEntries(section: string, ids: SitemapIds): SitemapEntry[] {
  if (section === 'core') {
    return [
      { path: '', priority: 1.0, changeFrequency: 'hourly' },
      { path: '/competitions', priority: 0.9, changeFrequency: 'daily' },
    ];
  }

  const dash = section.lastIndexOf('-');
  if (dash < 0) return [];
  const name = section.slice(0, dash);
  const meta = ENTITY_META[name];
  if (!meta) return [];

  const chunk = Number(section.slice(dash + 1)) || 0;
  const list = ids[name as keyof SitemapIds] ?? [];
  const slice = list.slice(chunk * SITEMAP_SECTION_SIZE, (chunk + 1) * SITEMAP_SECTION_SIZE);
  return slice.map((id) => ({ path: `${meta.prefix}/${id}`, priority: meta.priority, changeFrequency: meta.changeFrequency }));
}

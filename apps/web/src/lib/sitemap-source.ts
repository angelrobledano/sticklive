/**
 * Origen de datos del sitemap: los ids de entidad que publica la API.
 *
 * Compartido por el sitemap (`app/sitemap.ts`) y su índice
 * (`app/sitemap-index.xml/route.ts`) para que ambos declaren exactamente las
 * mismas secciones: si divergieran, el índice apuntaría a ficheros inexistentes.
 *
 * Si la API no responde se degrada a la sección `core` (home + listado de
 * competiciones) en vez de romper el sitemap o el índice.
 */

import type { SitemapIds } from './sitemap';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000';

export async function fetchSitemapIds(): Promise<SitemapIds> {
  try {
    const res = await fetch(`${API_URL}/meta/sitemap`, { next: { revalidate: 3600 } });
    if (res.ok) return (await res.json()) as SitemapIds;
  } catch {
    /* sitemap mínimo si la API no responde */
  }
  return { competitions: [], teams: [], players: [], matches: [] };
}

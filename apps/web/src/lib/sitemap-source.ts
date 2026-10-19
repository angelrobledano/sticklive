/**
 * Origen de datos del sitemap: los ids de entidad que publica la API.
 *
 * Compartido por el sitemap (`app/sitemap.ts`) y su índice
 * (`app/sitemap-index.xml/route.ts`) para que ambos declaren exactamente las
 * mismas secciones: si divergieran, el índice apuntaría a ficheros inexistentes.
 *
 * Si la API no responde, el índice y las secciones de entidad responden 503
 * (F1-8). Solo `generateSitemaps()` tolera el fallo, porque corre en el build.
 */

import type { SitemapIds } from './sitemap';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000';

/** La API no ha dado los ids del sitemap (caída, timeout o respuesta no OK). */
export class SitemapSourceError extends Error {
  constructor(cause: string) {
    super(`sitemap: /meta/sitemap no disponible (${cause})`);
    this.name = 'SitemapSourceError';
  }
}

/**
 * Versión estricta (F1-8, SEO-07 de `docs/AUDITORIA_SEO_2026-10-16.md`): si la
 * API falla, lanza. La usan el índice y las secciones de entidad para responder
 * 5xx en vez de publicar un sitemap degradado: Google reintenta y conserva la
 * última versión buena. Una lista vacía de la API (sin errores) sí es válida.
 */
export async function fetchSitemapIdsStrict(): Promise<SitemapIds> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/meta/sitemap`, { next: { revalidate: 3600 } });
  } catch (err) {
    throw new SitemapSourceError(err instanceof Error ? err.message : String(err));
  }
  if (!res.ok) throw new SitemapSourceError(`HTTP ${res.status}`);
  return (await res.json()) as SitemapIds;
}

/**
 * Versión tolerante: si la API falla devuelve listas vacías. Solo para
 * `generateSitemaps()`, que también corre en el build (sin API): ahí no puede
 * lanzar. Lo que ve Google lo decide el índice, que usa la versión estricta.
 */
export async function fetchSitemapIds(): Promise<SitemapIds> {
  try {
    return await fetchSitemapIdsStrict();
  } catch {
    return { competitions: [], teams: [], players: [], seasons: [], matches: [] };
  }
}

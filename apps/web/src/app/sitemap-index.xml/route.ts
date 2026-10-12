import { SITE_URL } from '@/lib/seo';
import { sitemapIndexXml, sitemapSectionIds } from '@/lib/sitemap';
import { fetchSitemapIds } from '@/lib/sitemap-source';

/**
 * Índice de sitemaps (`sitemapindex`).
 *
 * Con `generateSitemaps()` Next 16 sirve cada sección en `/sitemap/<id>.xml` y
 * **no genera índice**: `/sitemap.xml` devuelve 404. Esta ruta es la que
 * declara `robots.ts`, y sin ella Google no ve ninguna de las secciones del
 * sitemap (14.050 URLs) — solo descubre lo que alcanza por enlaces.
 *
 * El contenido y las secciones salen de las mismas funciones puras que el
 * sitemap, así que índice y ficheros no pueden divergir.
 */
export async function GET(): Promise<Response> {
  const ids = await fetchSitemapIds();
  return new Response(sitemapIndexXml(sitemapSectionIds(ids), SITE_URL), {
    headers: {
      // Mismo Content-Type que usa Next para los sitemaps.
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}

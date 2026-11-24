import type { MetadataRoute } from 'next';
import { SUPPORTED_LOCALES } from '@/lib/locales';
import { SITE_URL } from '@/lib/seo';
import { sitemapEntries, sitemapLanguages, sitemapSectionIds } from '@/lib/sitemap';
import { fetchSitemapIdsStrict, SitemapSourceError } from '@/lib/sitemap-source';

/**
 * Sitemap por secciones/trozos (#169): evita que un solo fichero supere el
 * límite de 50.000 URLs de Google cuando crezcan jugadores/partidos.
 *
 * OJO: con `generateSitemaps` Next **no genera ningún índice**. Publica una
 * sola ruta dinámica `/sitemap/<id>.xml`, así que `/sitemap.xml` devuelve 404.
 * El índice que declara estas secciones lo sirve `app/sitemap-index.xml/route.ts`
 * y es la URL que anuncia `robots.ts`.
 */
export async function generateSitemaps(): Promise<Array<{ id: string }>> {
  // La protección F1-8 vive en RUNTIME (el índice y las secciones responden
  // 503 si la API falla; ver sitemap-index.xml/route.ts). Aquí, en cambio,
  // corremos en el BUILD: la imagen se construye sola en CI, sin API, y si
  // esta llamada lanzara (F1-8 original), ningún build de imagen sería
  // posible. Así que ante un fallo de la fuente publicamos solo `core` — como
  // antes de F1-8 — y dejamos que el runtime estricto decida lo demás
  // cuando la API esté viva.
  try {
    return sitemapSectionIds(await fetchSitemapIdsStrict()).map((id) => ({ id }));
  } catch (err) {
    if (!(err instanceof SitemapSourceError)) throw err;
    return [{ id: 'core' }];
  }
}

/**
 * Cada ruta se lista una vez por locale, con el bloque de alternates (Google
 * entiende así la relación hreflang entre ellas).
 *
 * OJO: en esta versión de Next, con `generateSitemaps` el `id` llega como
 * **Promise** (params asíncronos). `await` también funciona si viniera resuelto.
 */
export default async function sitemap(props: { id: string | Promise<string> }): Promise<MetadataRoute.Sitemap> {
  const id = await props.id;
  // `core` no depende de la API. Las secciones de entidad usan la fuente
  // estricta (F1-8): si la API falla, la respuesta es 5xx y no una lista vacía.
  const ids = id === 'core'
    ? { competitions: [], teams: [], players: [], seasons: [], matches: [] }
    : await fetchSitemapIdsStrict();
  // #337: el lastmod sale de los datos de cada entidad (updatedAt/finishedAt/
  // scheduledAt), no de `new Date()`. Si una entrada no trae fecha, se omite el
  // lastModified en vez de firmar todas las URLs con el mismo timestamp falso.
  return sitemapEntries(id, ids).flatMap(({ path, lastModified }) =>
    SUPPORTED_LOCALES.map((locale) => ({
      url: `${SITE_URL}/${locale}${path}`,
      ...(lastModified ? { lastModified } : {}),
      // F2-5: `changefreq` y `priority` se omiten a propósito; Google los ignora.
      // Mismo bloque hreflang que sirve el HTML, `x-default` incluido.
      alternates: { languages: sitemapLanguages(path, SITE_URL, SUPPORTED_LOCALES) },
    }))
  );
}

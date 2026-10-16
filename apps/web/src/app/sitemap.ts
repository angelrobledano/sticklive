import type { MetadataRoute } from 'next';
import { SUPPORTED_LOCALES } from '@/lib/locales';
import { SITE_URL } from '@/lib/seo';
import { sitemapEntries, sitemapLanguages, sitemapSectionIds } from '@/lib/sitemap';
import { fetchSitemapIds, fetchSitemapIdsStrict } from '@/lib/sitemap-source';

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
  return sitemapSectionIds(await fetchSitemapIds()).map((id) => ({ id }));
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
    ? { competitions: [], teams: [], players: [], matches: [] }
    : await fetchSitemapIdsStrict();
  // #337: el lastmod sale de los datos de cada entidad (updatedAt/finishedAt/
  // scheduledAt), no de `new Date()`. Si una entrada no trae fecha, se omite el
  // lastModified en vez de firmar todas las URLs con el mismo timestamp falso.
  return sitemapEntries(id, ids).flatMap(({ path, priority, changeFrequency, lastModified }) =>
    SUPPORTED_LOCALES.map((locale) => ({
      url: `${SITE_URL}/${locale}${path}`,
      ...(lastModified ? { lastModified } : {}),
      changeFrequency,
      priority,
      // Mismo bloque hreflang que sirve el HTML, `x-default` incluido.
      alternates: { languages: sitemapLanguages(path, SITE_URL, SUPPORTED_LOCALES) },
    }))
  );
}

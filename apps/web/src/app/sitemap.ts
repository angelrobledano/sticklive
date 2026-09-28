import type { MetadataRoute } from 'next';
import { SUPPORTED_LOCALES } from '@/lib/locales';
import { SITE_URL } from '@/lib/seo';
import { sitemapEntries, sitemapSectionIds, type SitemapIds } from '@/lib/sitemap';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000';

async function fetchIds(): Promise<SitemapIds> {
  try {
    const res = await fetch(`${API_URL}/meta/sitemap`, { next: { revalidate: 3600 } });
    if (res.ok) return (await res.json()) as SitemapIds;
  } catch {
    /* sitemap mínimo si la API no responde */
  }
  return { competitions: [], teams: [], players: [], matches: [] };
}

/**
 * Sitemap por secciones/trozos (#169): evita que un solo fichero supere el
 * límite de 50.000 URLs de Google cuando crezcan jugadores/partidos. Next
 * publica un índice y un fichero por id.
 */
export async function generateSitemaps(): Promise<Array<{ id: string }>> {
  return sitemapSectionIds(await fetchIds()).map((id) => ({ id }));
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
  const ids = await fetchIds();
  // #337: el lastmod sale de los datos de cada entidad (updatedAt/finishedAt/
  // scheduledAt), no de `new Date()`. Si una entrada no trae fecha, se omite el
  // lastModified en vez de firmar todas las URLs con el mismo timestamp falso.
  return sitemapEntries(id, ids).flatMap(({ path, priority, changeFrequency, lastModified }) =>
    SUPPORTED_LOCALES.map((locale) => ({
      url: `${SITE_URL}/${locale}${path}`,
      ...(lastModified ? { lastModified } : {}),
      changeFrequency,
      priority,
      alternates: {
        languages: Object.fromEntries(
          SUPPORTED_LOCALES.map((l) => [l, `${SITE_URL}/${l}${path}`])
        ),
      },
    }))
  );
}

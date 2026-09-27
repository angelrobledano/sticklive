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
 */
export default async function sitemap(props: { id: string }): Promise<MetadataRoute.Sitemap> {
  const ids = await fetchIds();
  const now = new Date();
  return sitemapEntries(props.id, ids).flatMap(({ path, priority, changeFrequency }) =>
    SUPPORTED_LOCALES.map((locale) => ({
      url: `${SITE_URL}/${locale}${path}`,
      lastModified: now,
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

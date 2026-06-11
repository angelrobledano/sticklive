import type { MetadataRoute } from 'next';
import { SUPPORTED_LOCALES } from '@/lib/locales';
import { SITE_URL } from '@/lib/seo';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000';

interface SitemapIds {
  competitions: string[];
  teams: string[];
  players: string[];
  matches: string[];
}

/**
 * Sitemap multiidioma: cada ruta se lista una vez por locale, con el bloque
 * de alternates (Google entiende así la relación hreflang entre ellas).
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  let ids: SitemapIds = { competitions: [], teams: [], players: [], matches: [] };
  try {
    const res = await fetch(`${API_URL}/meta/sitemap`, { next: { revalidate: 3600 } });
    if (res.ok) ids = await res.json() as SitemapIds;
  } catch { /* sitemap mínimo si la API no responde */ }

  const paths: Array<{ path: string; priority: number; freq: MetadataRoute.Sitemap[number]['changeFrequency'] }> = [
    { path: '', priority: 1.0, freq: 'hourly' },
    { path: '/competitions', priority: 0.9, freq: 'daily' },
    ...ids.competitions.map((id) => ({ path: `/competitions/${id}`, priority: 0.8, freq: 'daily' as const })),
    ...ids.teams.map((id) => ({ path: `/teams/${id}`, priority: 0.7, freq: 'daily' as const })),
    ...ids.players.map((id) => ({ path: `/players/${id}`, priority: 0.6, freq: 'weekly' as const })),
    ...ids.matches.map((id) => ({ path: `/matches/${id}`, priority: 0.6, freq: 'hourly' as const })),
  ];

  const now = new Date();
  return paths.flatMap(({ path, priority, freq }) =>
    SUPPORTED_LOCALES.map((locale) => ({
      url: `${SITE_URL}/${locale}${path}`,
      lastModified: now,
      changeFrequency: freq,
      priority,
      alternates: {
        languages: Object.fromEntries(
          SUPPORTED_LOCALES.map((l) => [l, `${SITE_URL}/${l}${path}`])
        ),
      },
    }))
  );
}

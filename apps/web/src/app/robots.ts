import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/seo';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Páginas privadas/sin valor de búsqueda + JSON de la API (no son
        // páginas; los crawlers que respetan robots no deben indexarlos).
        disallow: ['/*/admin', '/*/login', '/*/settings', '/*/favorites', '/*/premium/', '/api/'],
      },
    ],
    // Índice propio: con `generateSitemaps()` Next no publica `/sitemap.xml`.
    sitemap: `${SITE_URL}/sitemap-index.xml`,
  };
}

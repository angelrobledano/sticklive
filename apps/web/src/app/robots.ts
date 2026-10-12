import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/seo';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Páginas privadas/sin valor de búsqueda
        disallow: ['/*/admin', '/*/login', '/*/settings', '/*/favorites', '/*/premium/'],
      },
    ],
    // Índice propio: con `generateSitemaps()` Next no publica `/sitemap.xml`.
    sitemap: `${SITE_URL}/sitemap-index.xml`,
  };
}

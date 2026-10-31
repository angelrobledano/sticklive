import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/seo';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        // Escudos de equipo en Google Imágenes (decisión 31/10/2026). La regla
        // más larga manda, así que gana a `Disallow: /api/` solo para el logo.
        allow: ['/', '/api/teams/*/logo'],
        // Páginas privadas/sin valor de búsqueda + JSON de la API (no son
        // páginas; los crawlers que respetan robots no deben indexarlos).
        disallow: ['/*/admin', '/*/login', '/*/settings', '/*/favorites', '/*/premium/', '/api/'],
      },
    ],
    // Índice propio: con `generateSitemaps()` Next no publica `/sitemap.xml`.
    sitemap: `${SITE_URL}/sitemap-index.xml`,
  };
}

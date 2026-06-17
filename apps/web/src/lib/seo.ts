import type { Metadata } from 'next';
import { SUPPORTED_LOCALES, type Locale } from '@/lib/locales';

/** Base pública del sitio — configúrala en producción (sin barra final) */
export const SITE_URL =
  process.env['NEXT_PUBLIC_SITE_URL'] ?? 'http://localhost:3001';

/**
 * Genera canonical + hreflang para una ruta dada.
 *
 * localeAlternates('es', '/competitions') →
 *   canonical: /es/competitions
 *   languages: { es: /es/competitions, en: /en/competitions, ..., x-default: /en/... }
 */
export function localeAlternates(locale: Locale, path = ''): Metadata['alternates'] {
  const clean = path === '/' ? '' : path;
  const languages: Record<string, string> = {};
  for (const l of SUPPORTED_LOCALES) {
    languages[l] = `${SITE_URL}/${l}${clean}`;
  }
  languages['x-default'] = `${SITE_URL}/en${clean}`;
  return {
    canonical: `${SITE_URL}/${locale}${clean}`,
    languages,
  };
}

export { isSupportedLocale } from '@/lib/locales';

// ─── Open Graph / Twitter ──────────────────────────────────────────────────────

/** Imagen social por defecto (1200×630, < 300 KB) servida desde /public. */
export const OG_IMAGE = {
  path: '/og-image.png',
  width: 1200,
  height: 630,
  type: 'image/png',
  alt: 'Stick Live — resultados de hockey patines en directo',
} as const;

/** Mapea el locale de la app al formato og:locale (idioma_PAÍS). */
const OG_LOCALE: Record<Locale, string> = {
  es: 'es_ES', en: 'en_US', pt: 'pt_PT', fr: 'fr_FR', it: 'it_IT',
};

/**
 * Construye los bloques openGraph + twitter (Metadata de Next) optimizados para
 * compartir en WhatsApp/Twitter/etc. Centralizado para que todas las páginas
 * usen el mismo formato (tarjeta grande 1.91:1, imagen segura, dimensiones).
 *
 * `title` debe ser corto (< 60 car.) y SIN el sufijo de marca para no cortarse.
 */
export function socialMeta(opts: {
  locale: Locale;
  path?: string;
  title: string;
  description: string;
  type?: 'website' | 'article';
  image?: { url: string; width: number; height: number; type?: string; alt?: string };
  /** La imagen la genera un fichero opengraph-image/twitter-image (OG dinámico). */
  dynamicImage?: boolean;
}): Pick<Metadata, 'openGraph' | 'twitter'> {
  const { locale, path = '', title, description, type = 'website' } = opts;
  const url = `${SITE_URL}/${locale}${path === '/' ? '' : path}`;

  // Con imagen dinámica (opengraph-image.tsx + twitter-image.tsx), NO fijamos
  // imágenes aquí: si lo hiciéramos, Next ignoraría las del fichero. Twitter
  // card e imagen los aporta twitter-image.tsx automáticamente.
  if (opts.dynamicImage) {
    return {
      openGraph: { type, url, siteName: 'Stick Live', locale: OG_LOCALE[locale], title, description },
    };
  }
  const img = opts.image
    ? opts.image
    : { url: `${SITE_URL}${OG_IMAGE.path}`, width: OG_IMAGE.width, height: OG_IMAGE.height, type: OG_IMAGE.type, alt: OG_IMAGE.alt };
  const imgUrl = img.url.startsWith('http') ? img.url : `${SITE_URL}${img.url}`;

  return {
    openGraph: {
      type,
      url,
      siteName: 'Stick Live',
      locale: OG_LOCALE[locale],
      title,
      description,
      images: [{
        url: imgUrl,
        secureUrl: imgUrl,
        width: img.width,
        height: img.height,
        type: img.type ?? 'image/png',
        alt: img.alt ?? title,
      }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [imgUrl],
    },
  };
}

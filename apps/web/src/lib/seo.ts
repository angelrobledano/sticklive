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
  path: '/og-image-v2.png',
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
 * Token de versión corto y determinista para la URL de una imagen social
 * dinámica (#274). Hash FNV-1a de 32 bits en base 36 (JS puro, sin dependencias).
 *
 * Se deriva del estado/marcador del partido (que va en el título OG, p. ej.
 * "CPC 2-2 LUB"): cambia en cada gol y al pasar de programado a en directo, de
 * modo que los scrapers (WhatsApp/Meta/X) piden una URL nueva en vez de
 * reutilizar su copia cacheada. Al ser determinista, la misma URL se comparte
 * entre peticiones del mismo estado (no rompe la caché del CDN entre visitas).
 */
export function socialImageVersion(seed: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    // Math.imul mantiene la aritmética en 32 bits sin desbordar el Number.
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * URL absoluta de la imagen social dinámica de una ruta (opengraph-image /
 * twitter-image) con el token de versión en `?v=`.
 *
 * El `path` puede llevar query (p. ej. `/competitions/x?season=y` en #279): la
 * imagen es un fichero fijo y no admite query, así que la descartamos solo aquí
 * (la URL de la página sigue conservando `?season=`). Sin esto se generarían
 * URLs rotas tipo `/competitions/x?season=y/opengraph-image`.
 */
export function socialImageUrl(
  locale: Locale,
  path: string,
  file: 'opengraph-image' | 'twitter-image',
  version: string,
): string {
  const cleanPath = path.split(/[?#]/)[0] ?? '';
  const clean = cleanPath === '/' ? '' : cleanPath;
  return `${SITE_URL}/${locale}${clean}/${file}?v=${version}`;
}

/**
 * URL absoluta SIN prefijo de idioma (#280). Se incrusta como texto en la
 * imagen de alineación: el receptor la abre sin locale y el middleware negocia
 * su idioma (#277). El receptor no hereda el idioma de quien comparte.
 */
export function localeLessUrl(path: string): string {
  return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

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
  type?: 'website' | 'article' | 'profile';
  image?: { url: string; width: number; height: number; type?: string; alt?: string };
  /** La imagen la genera un fichero opengraph-image/twitter-image (OG dinámico). */
  dynamicImage?: boolean;
}): Pick<Metadata, 'openGraph' | 'twitter'> {
  const { locale, path = '', title, description, type = 'website' } = opts;
  const url = `${SITE_URL}/${locale}${path === '/' ? '' : path}`;

  // Con imagen dinámica (opengraph-image.tsx + twitter-image.tsx) fijamos las
  // URLs a mano para incluir el token de versión (#274): la URL que Next genera
  // por defecto lleva un hash de build constante, así que quien la cachea
  // (WhatsApp/Meta/X) seguiría viendo el marcador del primer scrape. El token se
  // deriva del estado/marcador incrustado en el título OG.
  if (opts.dynamicImage) {
    const version = socialImageVersion(`${title}|${description}`);
    return {
      openGraph: {
        type,
        url,
        siteName: 'Stick Live',
        locale: OG_LOCALE[locale],
        title,
        description,
        images: [{
          url: socialImageUrl(locale, path, 'opengraph-image', version),
          width: OG_IMAGE.width,
          height: OG_IMAGE.height,
          type: OG_IMAGE.type,
          alt: title,
        }],
      },
      // #273: sin este bloque, X/Twitter heredaba el título/descripción
      // genéricos del layout (la imagen sí era la del partido). La card debe
      // llevar los datos del partido igual que openGraph.
      twitter: {
        card: 'summary_large_image',
        title,
        description,
        images: [socialImageUrl(locale, path, 'twitter-image', version)],
      },
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

// ─── Structured data / JSON-LD (#349) ─────────────────────────────────────────

const SITE_NAME = 'Stick Live';
const SPORT = 'Roller Hockey';

/**
 * WebSite + Organization a nivel de layout (#349): da marca en la SERP
 * (knowledge panel / sitelinks). Los builders son puros para poder testearlos y
 * se renderizan con `<JsonLd>` (que escapa el JSON).
 */
export function siteJsonLd(locale: Locale): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebSite', name: SITE_NAME, url: SITE_URL, inLanguage: locale },
      { '@type': 'Organization', name: SITE_NAME, url: SITE_URL, logo: `${SITE_URL}/icon-512.png` },
    ],
  };
}

/** SportsLeague + SportsSeason de una ficha de competición (#349). */
export function competitionJsonLd(opts: {
  leagueName: string;
  leagueUrl: string;
  seasonName?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  country?: string | null;
}): Record<string, unknown> {
  const league: Record<string, unknown> = {
    '@type': 'SportsLeague',
    name: opts.leagueName,
    url: opts.leagueUrl,
    sport: SPORT,
  };
  if (opts.country) league['areaServed'] = opts.country;

  const season: Record<string, unknown> = {
    '@type': 'SportsSeason',
    name: opts.seasonName ? `${opts.leagueName} ${opts.seasonName}` : opts.leagueName,
    sport: SPORT,
  };
  if (opts.startDate) season['startDate'] = opts.startDate;
  if (opts.endDate) season['endDate'] = opts.endDate;

  return { '@context': 'https://schema.org', '@graph': [league, season] };
}

/** ItemList del listado de competiciones (#349). */
export function competitionsListJsonLd(
  items: Array<{ name: string; url: string }>,
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      url: item.url,
    })),
  };
}

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

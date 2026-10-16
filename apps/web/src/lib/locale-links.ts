import { SUPPORTED_LOCALES, type Locale } from '@/lib/locales';

/**
 * Enlaces internos con idioma (SEO-01 de `docs/AUDITORIA_SEO_2026-10-16.md`).
 *
 * Lógica pura para poder testearla sin React y para que la guardia de CI use
 * EXACTAMENTE el mismo criterio que el componente `LocaleLink`.
 */

/** Primer segmento de las rutas de entidad (las que salen en el sitemap). */
export const ENTITY_ROUTE_SEGMENTS = ['competitions', 'teams', 'players', 'matches'] as const;

/**
 * Rutas de la app que viven bajo `/[locale]/…`. Solo a estas se les antepone el
 * idioma: `/api/…`, `/monitoring`, assets (`/brand/…`) o ficheros
 * (`/offline.html`, `/ads.txt`) se quedan como están.
 */
export const APP_ROUTE_SEGMENTS = [
  ...ENTITY_ROUTE_SEGMENTS,
  'search', 'favorites', 'settings', 'privacy', 'login', 'premium', 'admin',
] as const;

/**
 * Antepone el locale a una ruta interna de la app.
 *
 * No toca rutas ya localizadas (`/es/...`), ni rutas que no sean de la app, ni
 * URLs absolutas ni anclas. La raíz no duplica la barra: `/` → `/es`.
 */
export function withLocaleHref(path: string, locale: Locale): string {
  if (!path.startsWith('/')) return path;
  const [first = ''] = path.slice(1).split(/[/?#]/, 1);
  if (first !== '' && !(APP_ROUTE_SEGMENTS as readonly string[]).includes(first)) return path;
  if (first !== '' && (SUPPORTED_LOCALES as readonly string[]).includes(first)) return path;
  return `/${locale}${path === '/' ? '' : path}`;
}

/**
 * Hrefs internos a rutas de entidad emitidos SIN prefijo de idioma.
 *
 * Detecta las dos formas que usa la app: `href="/competitions/x"` y
 * `href={`/competitions/${id}`}`. Devuelve los fragmentos encontrados para que
 * la guardia pueda nombrar al culpable. Los ficheros que contienen el patrón
 * por diseño (este módulo y su test) quedan fuera por nombre.
 */
export function findUnprefixedEntityLinks(source: string): string[] {
  const segments = ENTITY_ROUTE_SEGMENTS.join('|');
  const re = new RegExp(`href=[^a-zA-Z]{0,2}\\/(${segments})(?=[/?"'\`}\\]])`, 'g');
  return source.match(re) ?? [];
}

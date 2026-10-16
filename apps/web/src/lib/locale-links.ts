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
 * Antepone el locale a una ruta interna.
 *
 * No toca rutas ya localizadas (`/es/...`), ni rutas no internas, ni el vacío.
 * La raíz no duplica la barra: `/` → `/es`.
 */
export function withLocaleHref(path: string, locale: Locale): string {
  if (!path.startsWith('/')) return path;
  const first = path.split('/')[1] ?? '';
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

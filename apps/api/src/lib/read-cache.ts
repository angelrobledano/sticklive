/**
 * Política de Cache-Control para los GET de lectura (auditoría I1).
 *
 * Pura y testeable: dado el método y la ruta, devuelve el valor de
 * Cache-Control o null si esa ruta no se cachea. El middleware de index.ts la
 * aplica ANTES del handler; los handlers que fijan su propia cabecera (live
 * max-age=5, meta max-age=3600) la sobreescriben, así que esto es el valor por
 * defecto sólo para los que no la fijan.
 *
 * `/matches/:id/stream` (SSE, 2 segmentos) NO casa ninguna regla → no se cachea.
 */
const READ_CACHE: Array<[RegExp, string]> = [
  [/^\/competitions(\/[^/]+)?$/,                     'public, max-age=300, stale-while-revalidate=3600'],
  [/^\/seasons\/[^/]+\/(standings|overview|stats)$/, 'public, max-age=60, stale-while-revalidate=300'],
  [/^\/teams\/[^/]+$/,                               'public, max-age=60, stale-while-revalidate=300'],
  [/^\/players\/[^/]+$/,                             'public, max-age=60, stale-while-revalidate=300'],
  [/^\/matches\/[^/]+$/,                             'public, max-age=30, stale-while-revalidate=120'],
];

export function cacheControlFor(method: string, path: string): string | null {
  if (method !== 'GET') return null;
  const hit = READ_CACHE.find(([re]) => re.test(path));
  return hit ? hit[1] : null;
}

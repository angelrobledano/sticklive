/**
 * Construcción de la URL a compartir (#282).
 *
 * Compartíamos `window.location.href` completo, así que parámetros de tracking
 * (`?src=push`) o de estado interno viajaban al receptor y contaminaban su
 * atribución. Aquí dejamos solo los parámetros que identifican el recurso
 * compartido (la temporada, en fichas de competición) y descartamos el hash.
 *
 * Función pura para poder testearla sin navegador.
 */
const DEFAULT_ALLOWED_PARAMS = ['season'];

export function buildShareUrl(
  href: string,
  allowedParams: readonly string[] = DEFAULT_ALLOWED_PARAMS,
): string {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    // Entrada no parseable (p. ej. relativa sin base): no la tocamos.
    return href;
  }

  const keep = new URLSearchParams();
  for (const key of allowedParams) {
    const value = url.searchParams.get(key);
    if (value !== null && value !== '') keep.set(key, value);
  }
  url.search = keep.toString();
  url.hash = '';
  return url.toString();
}

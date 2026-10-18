/**
 * Normalización de UUIDs en la ruta (F2-4).
 *
 * `/es/teams/FA1575FB-…` servía un 200 con canonical en mayúsculas: un
 * duplicado auto-canónico por una URL que nadie enlaza así, pero que Google
 * puede descubrir. El middleware redirige con 301 a la versión en minúsculas
 * antes de resolver el idioma.
 */

/** UUID canónico 8-4-4-4-12 dentro de una ruta. */
const UUID_IN_PATH = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/** Devuelve la ruta con todos los UUID en minúsculas. */
export function lowercaseUuidPath(pathname: string): string {
  return pathname.replace(UUID_IN_PATH, (uuid) => uuid.toLowerCase());
}

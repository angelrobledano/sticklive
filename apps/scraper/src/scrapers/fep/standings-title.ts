/**
 * Normalización de títulos de la cabecera de clasificación.
 *
 * Vive en su propio módulo, sin dependencias del scraper, para poder testearlo
 * sin arrastrar `requireFepSourceId()` — que fep-standings.scraper.ts ejecuta a
 * nivel de módulo y lanza si falta FEP_SOURCE_ID (p. ej. en CI).
 */

/** Quita diacríticos y normaliza a MAYÚSCULAS para comparar títulos. */
function normalizeTitle(raw: string): string {
  return raw.normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase().trim();
}

// Títulos genéricos de la cabecera de la tabla que NO son un grupo real: las
// ligas son de tabla única. Incluye variantes con/sin tilde (es), catalán y en.
const GENERIC_STANDINGS_TITLES = new Set([
  'CLASIFICACION', 'CLASSIFICACIO', 'CLASSIFICACION', 'STANDINGS', 'CLASSIFICATION',
]);

/** True si el título es el genérico de la tabla (no un grupo distintivo). */
export function isGenericStandingsTitle(raw: string): boolean {
  return GENERIC_STANDINGS_TITLES.has(normalizeTitle(raw));
}

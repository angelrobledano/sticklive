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

// Palabras que acompañan a "GRUPO" pero no lo identifican ("GROUP PHASE").
const NON_GROUP_NAMES = new Set([
  'PHASE', 'FASE', 'STAGE', 'ETAPA', 'FINAL', 'FINALS', 'GRUPO', 'GRUP', 'GROUP',
]);

/**
 * Nombre del grupo a partir de la cabecera de UNA tabla de clasificación.
 *
 * FECAPA titula cada tabla «GRUPO GRUP A» (las etiquetas de idioma se
 * concatenan), mientras que el título de fase «FASE DE GRUPS…» NO identifica
 * un grupo. Devuelve solo la etiqueta («A», «NORTE») para que la web pinte
 * «Grupo A», igual que el grupo de una fase («GRUPO A» → `A`).
 */
export function parseGroupTitle(raw: string): string | undefined {
  const u = normalizeTitle(raw);
  const re = /\b(?:GRUPOS?|GRUPS?|GRUP|GROUP)\b/g;
  let end = -1;
  for (let m = re.exec(u); m; m = re.exec(u)) end = m.index + m[0].length;
  if (end < 0) return undefined;
  const name = u.slice(end).trim();
  if (!name || NON_GROUP_NAMES.has(name)) return undefined;
  // Letra/número de grupo ("A", "B2") o nombre corto ("NORTE", "SUR").
  if (!/^[A-Z0-9]{1,2}$/.test(name) && !/^[A-Z]{3,12}$/.test(name)) return undefined;
  return name;
}

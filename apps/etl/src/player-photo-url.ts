/**
 * Resolución de la URL de la foto de un jugador en el CDN de sidgad.
 *
 * El CDN aloja la foto con DOS patrones de nombre, no uno:
 *   · `{id}_{n}.jpg` — n = índice de subida (el mayor, la más reciente);
 *   · `{id}.jpg`     — sin variante.
 *
 * El scraper de fichas guardaba SIEMPRE `{id}_1.jpg` (a ciegas) y
 * `update-player-photos` solo sondeaba `{id}_{1..6}.jpg`, así que las fotos que
 * existían como `{id}.jpg` (≈29 % de la muestra auditada) quedaban en 404 y la
 * web mostraba la silueta por error. Aquí vive la lista de candidatos (pura) y
 * la resolución (delegando el "existe" en red al llamante), para poder fijarla
 * con tests sin tocar el CDN.
 */

/** Base del CDN de fichas de jugador. */
export const PHOTO_CDN = 'https://sidgad.cloud/rfep/images/fichas';

/** Índice máximo de variante `{id}_{n}.jpg` que se sondea. */
export const MAX_PHOTO_INDEX = 6;

/**
 * Candidatos de foto para un `idNum`, en orden de preferencia: primero las
 * variantes `{id}_{n}.jpg` de MAYOR a menor (la de índice más alto es la más
 * reciente) y, como último recurso, `{id}.jpg` (la que faltaba).
 */
export function photoCandidates(idNum: string): string[] {
  const out: string[] = [];
  for (let n = MAX_PHOTO_INDEX; n >= 1; n--) out.push(`${PHOTO_CDN}/${idNum}_${n}.jpg`);
  out.push(`${PHOTO_CDN}/${idNum}.jpg`);
  return out;
}

/**
 * `fep_player_7455` → `7455`. Devuelve `null` si la ref no encaja (no tocar).
 * El id puede ser numérico o alfanumérico (`\w+`).
 */
export function idNumFromSourceRef(sourceRef: string): string | null {
  const m = /^fep_player_([A-Za-z0-9]+)$/.exec(sourceRef);
  return m?.[1] ?? null;
}

/** Comprueba si una URL de foto existe (inyectable: red en producción, fake en test). */
export type PhotoExists = (url: string) => Promise<boolean>;

/**
 * Primera URL de foto que existe para `idNum`, o `null` si no existe ninguna.
 * `null` es una respuesta VÁLIDA: significa "este jugador no tiene foto" y debe
 * guardarse como tal (no inventar una URL muerta).
 */
export async function resolvePlayerPhoto(idNum: string, exists: PhotoExists): Promise<string | null> {
  for (const url of photoCandidates(idNum)) {
    if (await exists(url)) return url;
  }
  return null;
}

/**
 * Valor a guardar para `photo_url` en una pasada RÁPIDA: si la URL guardada ya
 * existe, se conserva (una sola comprobación); si no, se resuelve de cero. Evita
 * re-sondear los 7 candidatos por cada jugador ya correcto en la pasada
 * periódica (que es la mayoría).
 */
export async function resolvePlayerPhotoIfNeeded(
  idNum: string,
  currentUrl: string | null,
  exists: PhotoExists,
): Promise<string | null> {
  if (currentUrl && (await exists(currentUrl))) return currentUrl;
  return resolvePlayerPhoto(idNum, exists);
}

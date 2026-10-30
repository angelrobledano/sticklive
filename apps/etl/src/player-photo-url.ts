/**
 * Resolución de la URL de la foto de un jugador en el CDN de sidgad.
 *
 * El CDN sirve las fichas POR PORTAL, en carpetas distintas y con espacios de
 * id SEPARADOS:
 *   · `/rfep/images/fichas/{id}`        — portal FEP/RFEP (clubes españoles);
 *   · `/worldskate/images/fichas/{id}`  — portal World Skate (selecciones).
 *
 * El `id_player` de un acta pertenece al portal de ESA competición: el MISMO
 * jugador tiene ids distintos en cada portal (p. ej. Marc Grau Tallada es 4646
 * en el portal FEP —Barça— y 192 en el de World Skate). Sondear la carpeta
 * equivocada no da un 404 “limpio”: cuando el número colisiona devuelve la foto
 * de OTRO jugador (la ficha de España mostraba avatares con caras de jugadores
 * de club). Por eso el portal es un PARÁMETRO obligatorio de la resolución y no
 * un candidato más.
 *
 * Dentro de cada carpeta la ficha puede existir con DOS patrones de nombre:
 *   · `{id}_{n}.jpg` — n = índice de subida (el mayor, la más reciente);
 *   · `{id}.jpg`     — sin variante.
 */

/** Portal del CDN de fichas. */
import { playerIdFromRef, sourceByKey } from '../../scraper/src/core/sources.js';
export type PhotoArea = string;

/** Base del CDN de fichas por portal (mismo host, carpeta = portal sidgad). */
export const PHOTO_CDNS = new Proxy({} as Record<string, string> & { rfep: string; worldskate: string }, {
  get: (_t, portal: string) => `https://sidgad.cloud/${portal}/images/fichas`,
});

/**
 * Huecos seguidos que se toleran al buscar la ficha más reciente: la
 * numeración `{id}_{n}.jpg` sube con cada temporada (Marc Grau va por la _8) y
 * puede tener alguno (una ficha retirada). Tres huecos seguidos = no hay más.
 */
export const PHOTO_GAP = 3;
/** Tope de seguridad de la numeración. */
const MAX_PHOTO_INDEX = 60;

const variantUrl = (idNum: string, area: PhotoArea, n: number) => `${PHOTO_CDNS[area]}/${idNum}_${n}.jpg`;

/** `{base}/{id}_{n}.jpg` del portal e id dados → n; si no, null. */
function variantIndex(url: string, idNum: string, area: PhotoArea): number | null {
  const prefix = `${PHOTO_CDNS[area]}/${idNum}_`;
  if (!url.startsWith(prefix) || !url.endsWith('.jpg')) return null;
  const n = Number(url.slice(prefix.length, -4));
  return Number.isInteger(n) && n >= 1 ? n : null;
}

/** Última variante que existe a partir de `from` (incluido), o null. */
async function newestFrom(idNum: string, area: PhotoArea, from: number, exists: PhotoExists): Promise<number | null> {
  let newest: number | null = null;
  let misses = 0;
  for (let n = from; n <= MAX_PHOTO_INDEX && misses < PHOTO_GAP; n++) {
    if (await exists(variantUrl(idNum, area, n))) { newest = n; misses = 0; } else { misses++; }
  }
  return newest;
}

/**
 * Portal al que pertenece el id de un jugador, a partir de las refs de sus
 * equipos (`teams.source_ref`): los equipos de World Skate llevan ref `wse_*`;
 * el resto (FEP/clubes) son del portal rfep.
 *
 * Los equipos de selección son la única fuente de jugadores `fep_player_*` cuyo
 * id pertenece al portal World Skate. Tolera refs nulas (`teams.source_ref` es
 * nullable) y sin equipos → rfep (comportamiento previo).
 *
 * LÍMITE: si un jugador de World Skate no tiene fila en `team_players` se
 * clasifica como rfep y podría mostrar la foto homónima del portal FEP.
 */
export function photoAreaForTeamRefs(teamRefs: readonly (string | null | undefined)[]): PhotoArea {
  return teamRefs.some((ref) => ref?.startsWith('wse_') === true) ? 'worldskate' : 'rfep';
}

/**
 * `fep_player_7455` → `7455`. Devuelve `null` si la ref no encaja (no tocar).
 * El id puede ser numérico o alfanumérico (`\w+`).
 */
export function idNumFromSourceRef(sourceRef: string): string | null {
  const m = /^fep_player_([A-Za-z0-9]+)$/.exec(sourceRef);
  return m?.[1] ?? null;
}

/**
 * Id y carpeta del CDN de un jugador a partir de su ref (A1). Con refs por
 * portal (`fecapa_player_14782`) la carpeta sale de la propia ref. Las
 * `fep_player_` heredadas siguen decidiendo por sus equipos (World Skate).
 */
export function photoTargetFromRef(
  sourceRef: string,
  teamRefs: readonly (string | null | undefined)[],
): { idNum: string; area: PhotoArea } | null {
  const parsed = playerIdFromRef(sourceRef);
  if (!parsed) return null;
  if (parsed.sourceKey === 'fep') return { idNum: parsed.id, area: photoAreaForTeamRefs(teamRefs) };
  return { idNum: parsed.id, area: sourceByKey(parsed.sourceKey).client.portalPrefix };
}

/** Comprueba si una URL de foto existe (inyectable: red en producción, fake en test). */
export type PhotoExists = (url: string) => Promise<boolean>;

/**
 * Ficha MÁS RECIENTE de `idNum` en `area`: la variante `{id}_{n}.jpg` de mayor
 * n (se busca hacia arriba hasta `PHOTO_GAP` huecos seguidos) y, si no hay
 * ninguna, `{id}.jpg`. `null` es una respuesta VÁLIDA: el jugador no tiene foto
 * y debe guardarse como tal (no inventar una URL muerta).
 */
export async function resolvePlayerPhoto(
  idNum: string,
  area: PhotoArea,
  exists: PhotoExists,
): Promise<string | null> {
  const n = await newestFrom(idNum, area, 1, exists);
  if (n !== null) return variantUrl(idNum, area, n);
  const plain = `${PHOTO_CDNS[area]}/${idNum}.jpg`;
  return (await exists(plain)) ? plain : null;
}

/**
 * Pasada diaria: si la guardada es una variante del portal e id correctos y
 * sigue existiendo, solo se mira si hay alguna POSTERIOR (la ficha de la
 * temporada nueva). Si no, se resuelve de cero.
 */
export async function resolvePlayerPhotoIfNeeded(
  idNum: string,
  area: PhotoArea,
  currentUrl: string | null,
  exists: PhotoExists,
): Promise<string | null> {
  const k = currentUrl ? variantIndex(currentUrl, idNum, area) : null;
  if (k !== null && (await exists(currentUrl!))) {
    const newer = await newestFrom(idNum, area, k + 1, exists);
    return newer !== null ? variantUrl(idNum, area, newer) : currentUrl;
  }
  return resolvePlayerPhoto(idNum, area, exists);
}

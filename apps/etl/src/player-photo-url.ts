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

/** Índice máximo de variante `{id}_{n}.jpg` que se sondea. */
export const MAX_PHOTO_INDEX = 6;

/**
 * Candidatos de foto para un `idNum` en el portal `area`, en orden de
 * preferencia: primero las variantes `{id}_{n}.jpg` de MAYOR a menor y, como
 * último recurso, `{id}.jpg`.
 *
 * Criterio: dentro de un portal el `idNum` identifica al jugador, así que TODAS
 * sus fichas son suyas (verificado: en World Skate el id 89 tiene `89.jpg` —con
 * la camiseta de la selección— y `89_1.jpg` —con la del club—, el mismo
 * jugador). La preferencia por la variante `_n` replica la convención ya
 * validada en el portal FEP (el índice mayor es la subida más reciente).
 */
export function photoCandidates(idNum: string, area: PhotoArea): string[] {
  const base = PHOTO_CDNS[area];
  const out: string[] = [];
  for (let n = MAX_PHOTO_INDEX; n >= 1; n--) out.push(`${base}/${idNum}_${n}.jpg`);
  out.push(`${base}/${idNum}.jpg`);
  return out;
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
 * Primera URL de foto que existe para `idNum` en `area`, o `null` si no existe
 * ninguna. `null` es una respuesta VÁLIDA: significa "este jugador no tiene
 * foto" y debe guardarse como tal (no inventar una URL muerta).
 */
export async function resolvePlayerPhoto(
  idNum: string,
  area: PhotoArea,
  exists: PhotoExists,
): Promise<string | null> {
  for (const url of photoCandidates(idNum, area)) {
    if (await exists(url)) return url;
  }
  return null;
}

/**
 * Valor a guardar para `photo_url` en una pasada RÁPIDA: conserva la URL
 * guardada SOLO si sigue existiendo Y es una foto candidata del jugador en su
 * portal (mismo id y misma carpeta); si no, resuelve de cero.
 *
 * Conservar cualquier URL existente (comportamiento anterior) fijaba para
 * siempre fotos equivocadas: la de otro portal por colisión de id, o la de otro
 * id tras un cambio de ref. Ambas hay que re-resolverlas.
 */
export async function resolvePlayerPhotoIfNeeded(
  idNum: string,
  area: PhotoArea,
  currentUrl: string | null,
  exists: PhotoExists,
): Promise<string | null> {
  if (currentUrl && photoCandidates(idNum, area).includes(currentUrl) && (await exists(currentUrl))) {
    return currentUrl;
  }
  return resolvePlayerPhoto(idNum, area, exists);
}

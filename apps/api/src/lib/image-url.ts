/**
 * Resolución de la URL de una imagen (escudo/foto) sin que un fallo de la BD
 * tumbe la respuesta.
 *
 * `team-logo.ts` y `player-photo.ts` consultan `logo_url`/`photo_url` en
 * Postgres cuando no hay fichero local. Durante el incidente del 2026-10-05, un
 * pool de conexiones saturado devolvía "Connection terminated due to connection
 * timeout": la query lanzaba, la ruta no la capturaba y cada escudo respondía
 * 500 (y ensuciaba Sentry). El cliente sí tiene fallback, pero un 500 no es la
 * forma correcta de decir "no hay imagen".
 *
 * Además de capturar el error, acota la espera: si Postgres no responde en
 * `timeoutMs`, se trata como "sin imagen" en vez de dejar la petición colgada
 * los 5 s de `connectionTimeoutMillis` del pool. El fallback del cliente llega
 * antes y la página no se queda a medias.
 */

/** Presupuesto máximo para resolver la URL de UNA imagen (ms). */
export const IMAGE_URL_LOOKUP_TIMEOUT_MS = 2000;

/**
 * Ejecuta `lookup` y devuelve su URL, o `null` si:
 *   · la consulta lanza (BD caída, timeout del pool, etc.);
 *   · tarda más de `timeoutMs`;
 *   · no encuentra fila / el campo es null.
 *
 * Nunca propaga el error: "sin imagen" es un 404 esperado, no un 500.
 */
export async function lookupImageUrl(
  lookup: () => Promise<string | null>,
  timeoutMs: number = IMAGE_URL_LOOKUP_TIMEOUT_MS,
): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // El `.catch` interno deja la promesa como "manejada": si gana el timeout y
    // la consulta rechaza después, no se dispara unhandledRejection.
    return await Promise.race<string | null>([
      lookup().catch(() => null),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * FEP_SOURCE_ID — UUID de la fila `data_sources` (scraper_key = 'fep_hockey').
 *
 * Es OBLIGATORIO: se estampa en la columna `source_id` (tipo UUID) de
 * competiciones, equipos, partidos y clasificaciones. Antes los scrapers caían
 * a un literal `'FEP_HOCKEY_PLACEHOLDER'` cuando la env no estaba definida, lo
 * que reventaba el upsert con `invalid input syntax for type uuid` y, en el
 * loader de partidos, se disfrazaba del engañoso "competición no indexada o
 * equipos no registrados" (todos los partidos omitidos en silencio).
 *
 * Mejor fallar pronto y con un mensaje accionable.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Devuelve el FEP_SOURCE_ID validado, o lanza un error claro si falta / es inválido. */
export function requireFepSourceId(): string {
  const id = process.env['FEP_SOURCE_ID'];
  if (!id || !UUID_RE.test(id)) {
    throw new Error(
      `FEP_SOURCE_ID ${id ? `("${id}") no es un UUID válido` : 'no está definido'}. ` +
        'Es el id de la fila data_sources (scraper_key=fep_hockey) y es obligatorio ' +
        'para el scraping. Defínelo en .env.prod — lo imprime seed-ok-liga.ts como SOURCE_ID.'
    );
  }
  return id;
}

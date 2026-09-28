/**
 * Construcción del `error_message` que el loader de partidos escribe en
 * scrape_logs (#332).
 *
 * Antes se guardaba solo un contador ("N partidos fallaron"), así que un
 * partido que fallaba de forma recurrente era indetectable desde la tabla: el
 * detalle (qué partido y por qué) solo vivía en stdout, que se rota. Aquí
 * guardamos el detalle del primer fallo identificado por su `source_ref`
 * (p. ej. `fep_match_12345`) y contamos el resto, igual que hace el loader de
 * standings. No cambia el esquema: `scrape_logs.error_message` ya es TEXT.
 */

export interface MatchLoadError {
  /** Etiqueta legible del partido (equipos + fecha). */
  item: string;
  /** Motivo del fallo. */
  error: string;
  /** Identidad de fuente del partido (p. ej. `fep_match_12345`). */
  sourceRef?: string;
}

/**
 * Devuelve `undefined` si no hubo fallos; con uno, `source_ref: motivo`; con
 * varios, el primero y `(+N partidos más)`.
 */
export function buildMatchErrorMessage(errors: MatchLoadError[]): string | undefined {
  if (errors.length === 0) return undefined;

  const first = errors[0]!;
  const ref = first.sourceRef ?? first.item;
  const detail = `${ref}: ${first.error}`;

  return errors.length > 1 ? `${detail} (+${errors.length - 1} partidos más)` : detail;
}

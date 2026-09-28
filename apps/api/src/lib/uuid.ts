/**
 * Validación de formato UUID para los ids de ruta (#275).
 *
 * Postgres castea implícitamente el parámetro a uuid al compararlo con una
 * columna uuid: un id que no es UUID hace fallar la query y el `catch` de la
 * ruta devolvía un 500 (y ruido en logs). Validamos el formato ANTES de tocar
 * la BD para responder 404 en enlaces corruptos/antiguos o bots.
 *
 * Contrato:
 *  - Acepta el formato canónico 8-4-4-4-12 en hex, sin distinguir mayúsculas.
 *  - NO recorta espacios ni normaliza: un id con espacios no es el id real y
 *    debe tratarse como inexistente (404).
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

import { db } from '../client.js';

/**
 * Corrige el reparto nombre/apellidos de un jugador ya dado de alta (C1).
 *
 * Antes de leer el nombre de pila que marca el acta, el alta tomaba la última
 * palabra como nombre: "PASCUAL MATÍAS JOSÉ" quedaba como "JOSÉ" / "PASCUAL
 * MATÍAS". Solo se reescribe si son las MISMAS palabras en otro orden, así no
 * se pisa un nombre corregido a mano (tampoco uno con otras mayúsculas).
 * Devuelve si cambió algo.
 */
export async function fixPlayerNameSplit(playerId: string, firstName: string, lastName: string): Promise<boolean> {
  const res = await db.query(
    `UPDATE players SET first_name = $2, last_name = $3, updated_at = NOW()
      WHERE id = $1
        AND (first_name, last_name) IS DISTINCT FROM ($2, $3)
        AND last_name || ' ' || first_name = $3 || ' ' || $2`,
    [playerId, firstName, lastName]
  );
  return (res.rowCount ?? 0) > 0;
}

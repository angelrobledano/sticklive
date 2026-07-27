/**
 * Se ejecuta UNA vez antes de todos los tests de integración.
 *
 * Dos cosas, en este orden:
 *   1. Comprobar que apuntamos a una base de pruebas (los tests hacen TRUNCATE
 *      de todo; contra producción sería catastrófico).
 *   2. Aplicar las migraciones desde cero.
 */
import { comprobarBaseDePruebas } from './db.js';

export default async function setup() {
  comprobarBaseDePruebas();

  // Import dinámico DESPUÉS de la comprobación: `packages/db` crea el pool al
  // importarse y revienta si falta DATABASE_URL. Importándolo arriba, el error
  // que vería quien no tiene la base levantada sería un críptico "DATABASE_URL
  // no definida" en vez del mensaje con instrucciones.
  const { migrar } = await import('./db.js');
  const { closeDb } = await import('@sports/db');

  const inicio = Date.now();
  const aplicadas = await migrar();
  console.log(
    aplicadas > 0
      ? `[tests] ${aplicadas} migraciones aplicadas en ${Date.now() - inicio} ms`
      : '[tests] esquema ya al día'
  );

  // El pool del setup no lo hereda el runner: se cierra aquí o el proceso
  // queda colgado al terminar.
  await closeDb();
}

/**
 * Soporte para los tests de integración: base real, migraciones reales.
 *
 * ── Por qué no se aísla con transacciones ──────────────────────────────────
 *
 * El patrón habitual (abrir transacción, correr el test, ROLLBACK) no sirve
 * aquí: `packages/db` expone un **pool singleton** y el código de producción
 * llama a `db.query()` directamente, cogiendo una conexión distinta cada vez.
 * Una transacción abierta en el test sería invisible para la función que
 * estamos probando.
 *
 * Así que se limpia por TRUNCATE entre tests. Es algo más lento y muchísimo
 * más honesto: la función bajo prueba se ejecuta exactamente igual que en
 * producción, con su propio manejo de conexiones.
 */
import { db } from '@sports/db';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, '../../../packages/db/migrations');

/**
 * Tablas que NO se vacían entre tests.
 * `_migrations` guarda el estado del esquema; borrarla obligaría a remigrar.
 */
const PRESERVAR = new Set(['_migrations']);

/**
 * Aplica todas las migraciones desde cero. Se llama una vez por ejecución
 * (globalSetup), no por test.
 *
 * Reusa los .sql reales en vez de un esquema de pruebas paralelo. Un esquema
 * duplicado se desincroniza en la primera migración que alguien olvide copiar,
 * y entonces los tests pasan a validar una base que no existe en ningún sitio.
 */
export async function migrar(): Promise<number> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      filename TEXT UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);

  const aplicadas = new Set(
    (await db.query<{ filename: string }>('SELECT filename FROM _migrations')).rows
      .map((r) => r.filename)
  );

  const ficheros = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  let n = 0;
  for (const f of ficheros) {
    if (aplicadas.has(f)) continue;
    await db.query(readFileSync(join(MIGRATIONS_DIR, f), 'utf-8'));
    await db.query('INSERT INTO _migrations(filename) VALUES($1)', [f]);
    n++;
  }
  return n;
}

/** Vacía todas las tablas de datos. Llamar en `beforeEach`. */
export async function limpiar(): Promise<void> {
  const { rows } = await db.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`
  );
  const tablas = rows.map((r) => r.tablename).filter((t) => !PRESERVAR.has(t));
  if (tablas.length === 0) return;

  // Una sola sentencia con CASCADE: respeta las claves ajenas sin tener que
  // saber el orden correcto, y RESTART IDENTITY deja los serial a cero para
  // que los tests no dependan de ejecuciones anteriores.
  await db.query(
    `TRUNCATE TABLE ${tablas.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`
  );
}

/**
 * Comprobación de seguridad: que nadie apunte los tests a una base con datos.
 *
 * `limpiar()` hace TRUNCATE de todo. Si alguien exporta el DATABASE_URL de
 * producción y lanza los tests —con el túnel SSH abierto, por ejemplo, que es
 * un escenario perfectamente normal en este proyecto— se lleva la base por
 * delante. Este guardarraíl vale mucho más de lo que cuesta.
 */
export function comprobarBaseDePruebas(): void {
  const url = process.env['DATABASE_URL'] ?? '';
  if (!url) {
    throw new Error(
      'DATABASE_URL no definida.\n' +
      'Levanta la base de pruebas:  docker compose -f docker-compose.test.yml up -d'
    );
  }
  const nombre = url.split('/').pop()?.split('?')[0] ?? '';
  if (!/test/i.test(nombre)) {
    throw new Error(
      `Los tests de integración hacen TRUNCATE de TODAS las tablas y la base "${nombre}" ` +
      'no lleva "test" en el nombre.\n' +
      'Abortando por seguridad: apunta DATABASE_URL a la base de pruebas.'
    );
  }
}

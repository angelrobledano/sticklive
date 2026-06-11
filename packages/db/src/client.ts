/**
 * Pool de conexiones PostgreSQL compartido.
 *
 * Un solo pool por proceso — no instanciar directamente `new Pool()` en
 * otros módulos. Importar `db` desde aquí y usar `db.query()`.
 *
 * Para transacciones, usar `withTransaction(fn)`.
 */
import pg from 'pg';
import { createLogger } from '@sports/logger';

const { Pool } = pg;

const log = createLogger({ module: 'db' });

if (!process.env['DATABASE_URL']) {
  throw new Error('DATABASE_URL no definida. Copia .env.example a .env y configúrala.');
}

export const db = new Pool({
  connectionString: process.env['DATABASE_URL'],
  min: Number(process.env['DATABASE_POOL_MIN'] ?? 2),
  max: Number(process.env['DATABASE_POOL_MAX'] ?? 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

db.on('error', (err) => {
  log.error({ err }, 'Error inesperado en cliente PostgreSQL inactivo');
});

db.on('connect', () => {
  log.debug('Nueva conexión PostgreSQL establecida');
});

/**
 * Ejecuta una función dentro de una transacción.
 * Hace ROLLBACK automático si la función lanza.
 *
 * Ejemplo:
 *   await withTransaction(async (client) => {
 *     await client.query('INSERT ...');
 *     await client.query('UPDATE ...');
 *   });
 */
export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Cierra el pool de conexiones limpiamente al apagar el proceso.
 */
export async function closeDb(): Promise<void> {
  await db.end();
  log.info('Pool PostgreSQL cerrado');
}

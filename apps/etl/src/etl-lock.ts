/**
 * Lock GLOBAL de ingesta (#317).
 *
 * El scheduler usa `flock /tmp/etl-pipeline.lock`, que SOLO excluye dentro de
 * un contenedor. La auditoría midió 2-4 escritores concurrentes del mismo feed
 * (contenedores duplicados, ejecuciones manuales, cron del host) y 736
 * deadlocks en 30 días (#316). El flock no puede verlos; un advisory lock de
 * Postgres sí: todos los escritores pasan por la misma BD.
 *
 * `pg_try_advisory_lock` es de SESIÓN: la sessión es un cliente DEDICADO del
 * pool que se retiene mientras se sostiene el lock (no devolverlo al pool,
 * donde otras queries lo usarían). Si el proceso muere, la conexión cae y
 * Postgres libera el lock solo — no hay cerrojos huérfanos.
 *
 * Semántica no bloqueante (try): quien llega tarde sale sin ejecutar, igual
 * que `flock -n`. El flock se mantiene como segunda capa (barato y local).
 */
import { db } from '@sports/db';
import { createLogger } from '@sports/logger';

const log = createLogger({ module: 'etl-lock' });

/** Clave arbitraria y estable (el algoritmo solo exige que sea la misma). */
const ETL_LOCK_KEY = 0x53544b4c; // 'STKL'

export interface EtlLock {
  release: () => Promise<void>;
}

/** Intenta tomar el lock global. null = ya lo tiene otro proceso (salir). */
export async function acquireEtlLock(): Promise<EtlLock | null> {
  const client = await db.connect();
  try {
    const r = await client.query<{ ok: boolean }>(
      `SELECT pg_try_advisory_lock($1) AS ok`,
      [ETL_LOCK_KEY]
    );
    if (!r.rows[0]?.ok) {
      client.release();
      return null;
    }
  } catch (err) {
    client.release();
    throw err;
  }

  let released = false;
  return {
    release: async () => {
      if (released) return;
      released = true;
      try {
        await client.query(`SELECT pg_advisory_unlock($1)`, [ETL_LOCK_KEY]);
      } catch (err) {
        log.warn({ err }, 'No se pudo liberar el advisory lock (la sesión muere igual)');
      } finally {
        client.release();
      }
    },
  };
}

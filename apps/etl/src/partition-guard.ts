// Sentry PRIMERO: instrumenta interceptando la carga de módulos (ver instrument.ts).
import './instrument.js';
import * as Sentry from '@sentry/node';
import { pathToFileURL } from 'node:url';
import { createLogger } from '@sports/logger';
import { db, closeDb } from '@sports/db';

/**
 * Guarda diaria del particionado de `match_events` (migración 047).
 *
 * Dos comprobaciones baratas que corren una vez al día desde el scheduler:
 *
 *   1. ASEGURA que existen las particiones de la temporada actual y las
 *      siguientes (PARTITION_SEASONS_AHEAD, 2 por defecto). Es `CREATE TABLE IF
 *      NOT EXISTS`, así que es idempotente: en régimen normal no hace nada (la
 *      047 ya creó hasta 2035/36), pero mantiene el árbol al día para siempre
 *      sin depender de que alguien se acuerde de crear la partición del año que
 *      viene. Adjuntar una partición de rango FUTURO es instantáneo (no hay
 *      datos que escanear ni partición DEFAULT que consultar — usamos el
 *      centinela `match_events_undated` con rango explícito, no DEFAULT).
 *
 *   2. ALERTA si `match_events_undated` tiene filas. Esa partición centinela
 *      recoge los eventos de partidos sin `scheduled_at` (COALESCE a 1900). En
 *      régimen normal debe quedar vacía; que reciba filas significa partidos sin
 *      fecha, que no participan del directo ni del cálculo por temporada — algo
 *      que conviene mirar, sobre todo durante el volcado histórico.
 *
 * Uso:  node dist/apps/etl/src/partition-guard.js
 *
 * Variables de entorno:
 *   PARTITION_SEASONS_AHEAD — temporadas futuras a asegurar además de la actual
 *                             (defecto: 2)
 */

const log = createLogger({ service: 'partition-guard' });

const SEASONS_AHEAD = Number(process.env['PARTITION_SEASONS_AHEAD'] ?? 2);

/** Año de la temporada de hockey a la que pertenece una fecha (arranca 1-ago). */
export function seasonYear(d: Date = new Date()): number {
  const y = d.getUTCFullYear();
  return d.getUTCMonth() + 1 >= 8 ? y : y - 1;
}

/**
 * Crea (IF NOT EXISTS) las particiones de `base` .. `base + ahead`. Devuelve los
 * nombres asegurados. Idempotente.
 */
export async function ensurePartitions(
  base: number = seasonYear(),
  ahead: number = SEASONS_AHEAD,
): Promise<string[]> {
  const nombres: string[] = [];
  for (let y = base; y <= base + ahead; y++) {
    // Los identificadores y los límites de una partición NO son parametrizables
    // en DDL ($1 no vale para nombres de tabla ni para FOR VALUES). `y` es un
    // entero calculado, no entrada externa; se valida por si acaso.
    if (!Number.isInteger(y)) throw new Error(`año de temporada inválido: ${y}`);
    const name = `match_events_s${y}`;
    await db.query(
      `CREATE TABLE IF NOT EXISTS ${name} PARTITION OF match_events
         FOR VALUES FROM ('${y}-08-01') TO ('${y + 1}-08-01')`,
    );
    nombres.push(name);
  }
  return nombres;
}

/**
 * Cuenta las filas de `match_events_undated`. Si hay alguna, avisa a Sentry
 * (warning, no error: el dato no está roto, pero indica partidos sin fecha).
 */
export async function checkUndated(): Promise<number> {
  const { rows } = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM match_events_undated`,
  );
  const n = Number(rows[0]!.n);
  if (n > 0) {
    log.warn(
      { count: n },
      'match_events_undated tiene filas: partidos sin scheduled_at, fuera del cálculo por temporada',
    );
    Sentry.captureMessage(
      `match_events_undated tiene ${n} evento(s): hay partidos sin fecha (scheduled_at NULL)`,
      { level: 'warning', extra: { count: n } },
    );
  }
  return n;
}

async function main(): Promise<void> {
  const aseguradas = await ensurePartitions();
  log.info({ particiones: aseguradas }, 'Particiones de temporada aseguradas (IF NOT EXISTS)');
  await checkUndated();
}

// Sólo se ejecuta al lanzarlo directamente (scheduler), no al importarlo (tests).
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main()
    .catch((err) => {
      log.error({ err }, 'partition-guard falló');
      Sentry.captureException(err);
      process.exitCode = 1;
    })
    // Proceso corto: hay que drenar Sentry antes de salir o se pierde el evento.
    .finally(async () => {
      await Sentry.flush(2000);
      await closeDb();
    });
}

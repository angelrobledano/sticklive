/**
 * Chequeo de versión de esquema al arrancar (auditoría 2.3).
 *
 * El servicio `migrate` aplica las migraciones en cada `up`, así que el
 * despliegue normal siempre deja la BD al día. Pero hay un hueco que no cubre:
 * arrancar la API contra un backup ANTIGUO restaurado a mano (una restauración
 * por el runbook, por ejemplo). Ahí el esquema va por detrás del código y las
 * queries fallan de formas confusas en caliente.
 *
 * Este chequeo compara la última migración presente en disco —la misma fuente
 * que usa `migrate`, vía `MIGRATIONS_DIR`— con la última registrada en
 * `_migrations`. Si la BD está por detrás, la API NO arranca y lo dice claro.
 *
 * Principio de diseño: el chequeo no debe introducir un modo de caída NUEVO
 * salvo el que busca. Por eso solo bloquea cuando confirma que la BD va
 * atrasada (o que no está inicializada); cualquier otra incidencia —no se puede
 * leer el directorio, no se puede consultar la BD por un blip de red— se degrada
 * a aviso y deja arrancar. Escape de emergencia: `SKIP_SCHEMA_CHECK=1`.
 */
import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from '@sports/logger';
import { db } from './client.js';

const log = createLogger({ service: 'schema-version' });

/** El esquema de la BD va por detrás del código: arranque abortado. */
export class SchemaOutdatedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaOutdatedError';
  }
}

// Misma resolución que migrate.ts: `MIGRATIONS_DIR` en producción (el bundle de
// dist/ no puede calcular la ruta relativa), y el cálculo relativo en local.
function migrationsDir(): string {
  return process.env['MIGRATIONS_DIR']
    ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
}

/** Número de una migración por su prefijo ("043_x.sql" → 43); NaN si no aplica. */
function migrationNumber(filename: string): number {
  const m = /^(\d+)/.exec(filename);
  return m ? Number(m[1]) : NaN;
}

/** Mayor migración presente en disco, o null si el directorio no se puede leer. */
function latestOnDisk(): { num: number; file: string } | null {
  let files: string[];
  try {
    files = readdirSync(migrationsDir()).filter((f) => f.endsWith('.sql'));
  } catch (err) {
    log.warn({ err, dir: migrationsDir() },
      'No se pudo leer el directorio de migraciones — se omite el chequeo de esquema');
    return null;
  }
  let best: { num: number; file: string } | null = null;
  for (const f of files) {
    const n = migrationNumber(f);
    if (Number.isNaN(n)) continue;
    if (!best || n > best.num) best = { num: n, file: f };
  }
  return best;
}

/** Mayor migración registrada en `_migrations`. Propaga si la tabla no existe. */
async function latestApplied(): Promise<number> {
  const res = await db.query<{ filename: string }>(`SELECT filename FROM _migrations`);
  let best = 0;
  for (const r of res.rows) {
    const n = migrationNumber(r.filename);
    if (!Number.isNaN(n) && n > best) best = n;
  }
  return best;
}

/**
 * Verifica que el esquema de la BD está al menos tan al día como el código.
 * Lanza {@link SchemaOutdatedError} si la BD va por detrás o no está
 * inicializada. No lanza por problemas de infraestructura: en ese caso avisa y
 * deja continuar (la propia API fallará sus queries si la BD no está lista).
 */
export async function assertSchemaCurrent(): Promise<void> {
  if (process.env['SKIP_SCHEMA_CHECK'] === '1') {
    log.warn('SKIP_SCHEMA_CHECK=1 — chequeo de versión de esquema desactivado');
    return;
  }

  const disk = latestOnDisk();
  if (!disk) return; // sin referencia en disco no se puede verificar (ya avisado)

  let applied: number;
  try {
    applied = await latestApplied();
  } catch (err) {
    // 42P01 = undefined_table: `_migrations` no existe ⇒ la BD nunca migró.
    if ((err as { code?: string }).code === '42P01') {
      throw new SchemaOutdatedError(
        'El esquema no está inicializado (no existe la tabla _migrations). ' +
        'Ejecuta las migraciones (servicio migrate) antes de arrancar la API.',
      );
    }
    log.warn({ err }, 'No se pudo consultar _migrations — se omite el chequeo de esquema');
    return;
  }

  if (applied < disk.num) {
    throw new SchemaOutdatedError(
      `Esquema desactualizado: la BD está en la migración ${String(applied).padStart(3, '0')} ` +
      `pero este build espera la ${disk.file}. Aplica las migraciones pendientes ` +
      `(servicio migrate) antes de arrancar la API. Para arrancar igualmente: SKIP_SCHEMA_CHECK=1.`,
    );
  }

  log.info({ applied, expected: disk.num }, 'Esquema al día');
}

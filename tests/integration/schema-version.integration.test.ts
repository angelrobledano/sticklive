/**
 * Chequeo de versión de esquema al arrancar (auditoría 2.3).
 *
 * `assertSchemaCurrent` compara la última migración en disco con la última
 * registrada en `_migrations` y bloquea el arranque si la BD va por detrás.
 * Se prueba contra Postgres real porque el valor está justo en esa comparación.
 *
 * Los casos que tocan `_migrations` quitan temporalmente la última fila y la
 * restauran en `finally`, para no dejar la tabla alterada a otros tests.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { db, closeDb, assertSchemaCurrent, SchemaOutdatedError } from '@sports/db';

async function ultimaMigracion(): Promise<{ id: number; filename: string }> {
  const { rows } = await db.query<{ id: number; filename: string }>(
    `SELECT id, filename FROM _migrations ORDER BY filename DESC LIMIT 1`,
  );
  expect(rows[0]).toBeDefined();
  return rows[0]!;
}

async function reinsertar(filename: string): Promise<void> {
  await db.query(
    `INSERT INTO _migrations (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING`,
    [filename],
  );
}

afterAll(async () => {
  await closeDb();
});

describe('assertSchemaCurrent — chequeo de esquema (2.3)', () => {
  it('no lanza cuando la BD está al día (migrada)', async () => {
    await expect(assertSchemaCurrent()).resolves.toBeUndefined();
  });

  it('lanza SchemaOutdatedError si falta la última migración', async () => {
    const last = await ultimaMigracion();
    await db.query(`DELETE FROM _migrations WHERE id = $1`, [last.id]);
    try {
      await expect(assertSchemaCurrent()).rejects.toBeInstanceOf(SchemaOutdatedError);
    } finally {
      await reinsertar(last.filename);
    }
  });

  it('SKIP_SCHEMA_CHECK=1 desactiva el chequeo aunque falte una migración', async () => {
    const last = await ultimaMigracion();
    await db.query(`DELETE FROM _migrations WHERE id = $1`, [last.id]);
    process.env['SKIP_SCHEMA_CHECK'] = '1';
    try {
      await expect(assertSchemaCurrent()).resolves.toBeUndefined();
    } finally {
      delete process.env['SKIP_SCHEMA_CHECK'];
      await reinsertar(last.filename);
    }
  });
});

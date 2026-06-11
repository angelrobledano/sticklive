/**
 * Ejecuta todas las migraciones pendientes en orden.
 *
 * Uso:
 *   npx tsx --env-file=.env packages/db/src/migrate.ts
 */
import { db, closeDb } from './client.js';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Relativo a este fichero, no al cwd: funciona desde la raíz y desde packages/db
const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

async function ensureMigrationsTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id        SERIAL PRIMARY KEY,
      filename  TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getApplied(): Promise<Set<string>> {
  const res = await db.query<{ filename: string }>(`SELECT filename FROM _migrations ORDER BY id`);
  return new Set(res.rows.map(r => r.filename));
}

/**
 * Si _migrations acaba de crearse vacía pero el esquema ya existe
 * (la migración 001 se aplicó manualmente), marcamos todas las migraciones
 * anteriores a la primera pendiente como ya aplicadas.
 */
async function bootstrapIfNeeded(files: string[]) {
  const applied = await getApplied();
  if (applied.size > 0) return; // tabla ya tiene registros, nada que hacer

  // Comprobar si el esquema inicial ya está presente
  const res = await db.query<{ exists: boolean }>(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'data_sources'
    ) AS exists
  `);
  if (!res.rows[0]?.exists) return; // esquema no existe, dejar que corra normal

  // El esquema existe pero _migrations estaba vacía → fue aplicado a mano.
  // Marcamos todos los archivos que fallen con "already exists" como aplicados.
  console.log('  ℹ️  Esquema detectado sin registro de migraciones.');
  console.log('     Marcando migraciones previas como ya aplicadas...');

  for (const file of files) {
    // Intentar ejecutar; si falla con "already exists", lo marcamos igualmente.
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    try {
      await db.query(sql);
    } catch (err: any) {
      const alreadyExists = err.message?.includes('already exists');
      if (!alreadyExists) throw err;
      // Si ya existe, simplemente lo registramos sin relanzar el error
    }
    await db.query(
      `INSERT INTO _migrations(filename) VALUES($1) ON CONFLICT DO NOTHING`,
      [file]
    );
    console.log(`  ✅ ${file} (marcada)`);
  }
}

async function main() {
  await ensureMigrationsTable();

  const files = readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  await bootstrapIfNeeded(files);

  const applied = await getApplied();

  let ran = 0;
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`  ⏭  ${file} (ya aplicada)`);
      continue;
    }
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    console.log(`  ▶  Aplicando ${file}...`);
    await db.query(sql);
    await db.query(`INSERT INTO _migrations(filename) VALUES($1)`, [file]);
    console.log(`  ✅ ${file}`);
    ran++;
  }

  if (ran === 0) {
    console.log('\nNada que migrar. Todo está al día.');
  } else {
    console.log(`\n✅ ${ran} migración(es) aplicada(s).`);
  }
}

main()
  .catch(err => { console.error('❌', err.message); process.exit(1); })
  .finally(() => closeDb());

/**
 * Consulta el UUID del data_source FEP en la DB y lo añade/actualiza en .env
 *
 * Uso:
 *   npx tsx --env-file=.env apps/etl/src/patch-env-source-id.ts
 */
import { db, closeDb } from '@sports/db';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

async function main() {
  const res = await db.query<{ id: string }>(
    `SELECT id FROM data_sources WHERE scraper_key = 'fep_hockey'`
  );
  if (!res.rows[0]) {
    console.error('❌ No se encontró data_source con scraper_key=fep_hockey');
    console.error('   Asegúrate de haber ejecutado seed-ok-liga.ts antes.');
    process.exit(1);
  }
  const sourceId = res.rows[0].id;

  // Ruta al .env en la raíz del monorepo
  const envPath = resolve(process.cwd(), '.env');
  let content = readFileSync(envPath, 'utf-8');

  if (content.includes('FEP_SOURCE_ID=')) {
    // Actualizar la línea existente
    content = content.replace(/^FEP_SOURCE_ID=.*/m, `FEP_SOURCE_ID=${sourceId}`);
    console.log(`✅ FEP_SOURCE_ID actualizado en .env → ${sourceId}`);
  } else {
    // Añadir tras la sección Scraper
    content = content.replace(
      /^(# === Scraper ===.*?)(\n# ===)/ms,
      `$1\nFEP_SOURCE_ID=${sourceId}$2`
    );
    // Fallback: añadir al final
    if (!content.includes(`FEP_SOURCE_ID=${sourceId}`)) {
      content += `\n# FEP data source UUID\nFEP_SOURCE_ID=${sourceId}\n`;
    }
    console.log(`✅ FEP_SOURCE_ID añadido a .env → ${sourceId}`);
  }

  writeFileSync(envPath, content, 'utf-8');
  console.log(`\nAhora re-ejecuta el pipeline:`);
  console.log(`  npx tsx --env-file=.env apps/etl/src/run-pipeline.ts --entity=all --season-id=e6ab9d19-cc4b-4095-a9ce-4407a4000737`);
}

main()
  .catch(err => { console.error('❌', err.message); process.exit(1); })
  .finally(() => closeDb());

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeLogoFile } from './logo-normalize.js';

// Destino: apps/web/public/escudos/*.png
// Misma resolución que run-pipeline/download-logos: ESCUDOS_DIR (volumen en
// producción) o, si no, la ruta del repo relativa a ESTE módulo (no a cwd).
//   npx tsx apps/etl/src/normalize-logos.ts
const OUT_DIR =
  process.env['ESCUDOS_DIR'] ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/public/escudos');

async function main() {
  const files = fs.existsSync(OUT_DIR)
    ? fs.readdirSync(OUT_DIR).filter((f) => f.toLowerCase().endsWith('.png'))
    : [];

  console.log('Escudos encontrados:', files.length);
  console.log('Directorio:', OUT_DIR);
  console.log('');

  let normalized = 0, skipped = 0, failed = 0;

  for (const file of files) {
    const full = path.join(OUT_DIR, file);
    try {
      const action = await normalizeLogoFile(full);
      if (action === 'normalized') {
        console.log('NORM  ', file);
        normalized++;
      } else {
        skipped++;
      }
    } catch (e) {
      console.error('FAIL  ', file, String(e));
      failed++;
    }
  }

  console.log('');
  console.log('Resumen:', normalized, 'normalizados,', skipped, 'ya normalizados,', failed, 'fallidos');
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => { console.error('Error:', e); process.exit(1); });

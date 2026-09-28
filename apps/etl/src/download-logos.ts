import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, closeDb } from '@sports/db';
import { normalizeLogoBuffer, normalizeLogoFile } from './logo-normalize.js';

// Destino: apps/web/public/escudos/{teamId}.png
// Ejecutar desde la raiz del monorepo:
//   npx tsx --env-file .env apps/etl/src/download-logos.ts
// Misma resolución que run-pipeline.ts: ESCUDOS_DIR (volumen en producción) o,
// si no, la ruta del repo relativa a ESTE módulo. Antes usaba process.cwd(), que
// al lanzarlo desde apps/etl escribía fuera del volumen.
const OUT_DIR =
  process.env['ESCUDOS_DIR'] ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/public/escudos');

async function downloadLogo(url: string, destPath: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      headers: {
        'Referer':    'https://www.hockeypatines.fep.es/',
        'User-Agent': 'Mozilla/5.0 (compatible; SportsBot/1.0)',
      },
    });
    if (!res.ok) return false;
    const raw = Buffer.from(await res.arrayBuffer());
    if (raw.length < 100) return false;
    const buf = await normalizeLogoBuffer(raw);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, buf);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const { rows } = await db.query<{ id: string; name: string; logo_url: string | null }>(
    'SELECT id, name, logo_url FROM teams ORDER BY name'
  );

  console.log('Equipos encontrados:', rows.length);
  console.log('Destino:', OUT_DIR);
  console.log('');

  let ok = 0, norm = 0, skip = 0, fail = 0;

  for (const team of rows) {
    const dest = path.join(OUT_DIR, team.id + '.png');

    if (fs.existsSync(dest)) {
      // Ya existe: si aún tiene transparencia o tamaño irregular, lo normalizamos
      // (idempotente: si ya está normalizado, se salta).
      try {
        const action = await normalizeLogoFile(dest);
        if (action === 'normalized') { console.log('NORM  ', team.name); norm++; }
        else { console.log('SKIP  ', team.name); skip++; }
      } catch (e) {
        console.log('FAIL  ', team.name, '(normalizando:', String(e), ')');
        fail++;
      }
      continue;
    }

    if (!team.logo_url) {
      console.log('NULL  ', team.name, '(sin logo_url en DB)');
      fail++;
      continue;
    }

    const success = await downloadLogo(team.logo_url, dest);
    if (success) {
      const size = fs.statSync(dest).size;
      console.log('OK    ', team.name, '(' + size + ' bytes)');
      ok++;
    } else {
      console.log('FAIL  ', team.name, '<-', team.logo_url);
      fail++;
    }

    await new Promise((r) => setTimeout(r, 150));
  }

  console.log('');
  console.log('Resumen:', ok, 'descargados,', norm, 'normalizados,', skip, 'ya normalizados,', fail, 'fallidos');
  await closeDb();
}

main().catch((e) => { console.error('Error:', e); process.exit(1); });

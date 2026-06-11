/**
 * Sonda para capturar el HTML COMPLETO de clasificación (sin truncar).
 * Hace POST directo a rfep_clasif_idc_3150_1.php y guarda la respuesta íntegra.
 *
 * Uso: npx ts-node --esm apps/scraper/src/scrapers/fep/fep-clasif-probe3.ts
 */
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const URL = 'https://www.server2.sidgad.es/rfep/rfep_clasif_idc_3150_1.php';
const IDC = '3150';

async function probe() {
  console.log(`POST ${URL}`);
  console.log(`Body: idc=${IDC}&site_lang=es\n`);

  const res = await fetch(URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Referer: 'https://www.hockeypatines.fep.es/',
      'X-Requested-With': 'XMLHttpRequest',
      Accept: 'text/html,*/*;q=0.8',
      'Accept-Language': 'es-ES,es;q=0.9',
    },
    body: `idc=${IDC}&site_lang=es`,
  });

  console.log(`Status: ${res.status} ${res.statusText}`);
  console.log(`Content-Type: ${res.headers.get('content-type')}`);

  const html = await res.text();
  console.log(`Body: ${html.length} bytes\n`);

  mkdirSync(join(process.cwd(), 'logs'), { recursive: true });

  const outPath = join(process.cwd(), 'logs', `rfep_clasif_idc_${IDC}_1_full.html`);
  writeFileSync(outPath, html, 'utf-8');
  console.log(`✅ HTML completo guardado: ${outPath}`);

  // Preview de las primeras filas
  const rowMatches = html.match(/<tr>[\s\S]*?<\/tr>/g) ?? [];
  console.log(`\nFilas <tr> encontradas: ${rowMatches.length}`);

  // Contar equipos (buscando celdas de posición)
  const positions = [...html.matchAll(/<div style="text-align: right;[^>]*>(\d+)<\/div>/g)];
  console.log(`Equipos detectados: ${positions.length}`);
  for (const m of positions) {
    console.log(`  Posición ${m[1]}`);
  }
}

probe().catch(console.error);

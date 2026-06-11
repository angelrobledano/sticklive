/**
 * Sonda rápida para ver la estructura de clasif_idc_3150_1.php
 * Uso: npx ts-node --esm apps/scraper/src/scrapers/fep/fep-clasif-probe.ts
 */
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

async function probe() {
  const url = 'https://www.server2.sidgad.es/rfep/clasif_idc_3150_1.php';
  const body = new URLSearchParams({ idc: '3150', site_lang: 'es' }).toString();

  console.log(`POST ${url}`);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0',
      Referer: 'https://www.hockeypatines.fep.es/',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body,
  });

  console.log(`Status: ${res.status}`);
  console.log(`Content-Type: ${res.headers.get('content-type')}`);
  const html = await res.text();
  console.log(`Body size: ${html.length} bytes`);
  console.log('\n── Primeros 3000 chars ──\n');
  console.log(html.slice(0, 3000));

  mkdirSync(join(process.cwd(), 'logs'), { recursive: true });
  writeFileSync(join(process.cwd(), 'logs', 'clasif-probe.html'), html);
  console.log('\n✅ HTML completo guardado en logs/clasif-probe.html');
}

probe().catch(console.error);

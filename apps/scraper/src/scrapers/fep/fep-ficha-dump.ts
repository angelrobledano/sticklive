/**
 * Vuelca el HTML crudo de la ficha de un partido a logs/ficha-{idp}.html
 * para analizar la estructura y ajustar el parser de FepFichaScraper.
 *
 * Uso: npx tsx apps/scraper/src/scrapers/fep/fep-ficha-dump.ts [idp] [idc]
 */
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { sidgadPost } from './sidgad-client.js';

const idp = process.argv[2] ?? '34277';
const idc = process.argv[3] ?? '3481';

void (async () => {
  const html = await sidgadPost(`rfep_gr_${idp}_1.php`, {
    idm: '1', idc, idp, tab: 'tab_ficha_resumen',
  });
  const outDir = join(process.cwd(), 'logs');
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, `ficha-${idp}.html`);
  writeFileSync(out, html, 'utf-8');
  console.log(`✅ ${html.length} bytes → ${out}`);
})();

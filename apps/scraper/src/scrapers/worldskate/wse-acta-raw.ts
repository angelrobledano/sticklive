/**
 * Imprime el HTML CRUDO del acta de World Skate, sin nada más.
 *
 * Sirve para congelar un golden file, igual que tenemos los de la FEP:
 *
 *   $DC exec -T etl npx tsx apps/scraper/src/scrapers/worldskate/wse-acta-raw.ts 3095 320 \
 *     > apps/scraper/src/scrapers/fep/__fixtures__/acta-wse-finalizada.html
 *
 * El `-T` es importante: sin él docker mete secuencias de terminal en la salida
 * y el fichero deja de ser el HTML que vio el scraper.
 */
import { SidgadClient } from '../fep/sidgad-client.js';

const idp = process.argv[2] ?? '3095';
const idc = process.argv[3] ?? '320';

const client = new SidgadClient({
  baseUrl: 'https://www.server2.sidgad.es/worldskate',
  portalPrefix: 'worldskate',
  referer: 'https://wse.sidgad.com/',
});

void (async () => {
  const html = await client.post(`rfep_gr_${idp}_1.php`, {
    idm: '1', idc, idp, tab: 'tab_ficha_resumen',
  });
  process.stdout.write(html);
})();

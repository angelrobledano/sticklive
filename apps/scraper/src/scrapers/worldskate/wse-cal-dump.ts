/**
 * Vuelca el HTML del calendario de World Skate para inspeccionar la estructura.
 *
 * Sirve para diagnosticar por qué el scraper no está recogiendo el marcador de
 * los partidos ya jugados: imprime, por cada fila de partido, las celdas con su
 * clase y su texto, de modo que se vea qué selector debería usarse.
 *
 * Uso (dentro del contenedor etl):
 *   npx tsx apps/scraper/src/scrapers/worldskate/wse-cal-dump.ts 320
 */
import * as cheerio from 'cheerio';
import { SidgadClient } from '../fep/sidgad-client.js';

const idc = process.argv[2] ?? '320';

const client = new SidgadClient({
  baseUrl: 'https://www.server2.sidgad.es/worldskate',
  portalPrefix: 'worldskate',
  referer: 'https://wse.sidgad.com/',
});

void (async () => {
  // Mismos parámetros que WorldskateScraper.scrape(), para que el HTML sea el
  // que ve el scraper de verdad y no otro.
  const html = await client.post(`rfep_cal_idc_${idc}_1.php`, { idc, site_lang: 'es' });
  console.log(`HTML recibido: ${html.length} bytes\n`);

  const $ = cheerio.load(html);
  const filas = $('tr').filter((_, tr) => $(tr).attr('gamedate') !== undefined);
  console.log(`Filas con gamedate: ${filas.length}\n`);

  filas.slice(0, 4).each((i, tr) => {
    const $tr = $(tr);
    const idp = $tr.find('i.game_report, a.link_ficha_partido, [idp]').attr('idp');
    console.log(`─── fila ${i}  gamedate=${$tr.attr('gamedate')}  idp=${idp ?? '(sin idp)'}`);
    $tr.find('td').each((j, td) => {
      const $td = $(td);
      const clase = $td.attr('class') ?? '(sin clase)';
      const texto = $td.text().replace(/\s+/g, ' ').trim();
      if (texto || clase !== '(sin clase)') {
        console.log(`   td[${j}] class="${clase}"  texto="${texto.slice(0, 60)}"`);
      }
    });
    console.log('');
  });

  // Y en crudo la primera fila, por si el marcador no está en un <td>.
  console.log('─── HTML crudo de la primera fila ───');
  console.log($.html(filas.first()).replace(/\s+/g, ' ').slice(0, 2000));
})();

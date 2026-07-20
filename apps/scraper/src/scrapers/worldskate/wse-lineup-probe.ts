/**
 * ¿Por qué las alineaciones de World Skate salen con 8 jugadores y no con 30?
 *
 * `parseLineups` está escrito contra el acta de la FEP:
 *   · tablas `table.competiciones_tabla_basic`
 *   · filas de jugador a partir de la tercera (`.slice(2)`)
 *   · nombre en una celda con el patrón "OKM - NOMBRE" (prefijo de licencia)
 *
 * Este script imprime las tablas REALES del acta de World Skate para ver cuáles
 * de esas tres suposiciones no se cumplen, y qué extrae hoy el parser.
 *
 * Uso (dentro del contenedor etl):
 *   npx tsx apps/scraper/src/scrapers/worldskate/wse-lineup-probe.ts 3095 320
 */
import * as cheerio from 'cheerio';
import { SidgadClient } from '../fep/sidgad-client.js';
import { parseLineups } from '../fep/fep-ficha.parser.js';

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
  const $ = cheerio.load(html);

  console.log(`\nHTML: ${html.length} bytes`);
  console.log(`cabecera .nombre1 = "${$('.nombre1').first().text().replace(/\s+/g, ' ').trim()}"\n`);

  // ── Lo que saca HOY el parser ───────────────────────────────────────────────
  const actual = parseLineups(html, idp);
  console.log(`── parseLineups extrae ahora: ${actual.length} filas`);
  for (const l of actual.slice(0, 10)) {
    console.log(`   ${l.isHome ? 'local' : 'visit'} #${l.jerseyNumber ?? '-'} ` +
                `${l.playerName}${l.role ? ` [${l.role}]` : ''}`);
  }

  // ── Todas las tablas con pinta de alineación ────────────────────────────────
  console.log('\n── Tablas del documento (>=4 filas):\n');
  $('table').each((i, t) => {
    const $t = $(t);
    const filas = $t.find('tr');
    if (filas.length < 4) return;
    const clase = $t.attr('class') ?? '(sin clase)';
    console.log(`TABLA ${i}  class="${clase}"  filas=${filas.length}`);

    filas.slice(0, 5).each((j, tr) => {
      const celdas = $(tr).find('td, th');
      const textos = celdas.map((_, c) => $(c).text().replace(/\s+/g, ' ').trim()).get();
      console.log(`   fila ${j} (${celdas.length} celdas): ${JSON.stringify(textos.slice(0, 9))}`);
    });
    console.log('');
  });

  // ── ¿Existe el patrón "XXX - NOMBRE" en alguna parte? ───────────────────────
  const conGuion = $('td').filter((_, td) => / - /.test($(td).text())).length;
  console.log(`Celdas con el patrón " - " (prefijo de licencia de la FEP): ${conGuion}`);
})();

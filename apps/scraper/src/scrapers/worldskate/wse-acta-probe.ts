/**
 * ¿Sirve World Skate un acta con la misma estructura que la FEP?
 *
 * De la respuesta depende todo el trabajo de dar actas a las competiciones que
 * no son de la FEP:
 *
 *   · Si algún endpoint devuelve el HTML de incidencias y `parseFicha` extrae
 *     eventos → sólo hay que inyectar el portal correcto en FepFichaScraper y
 *     quitar el filtro `source_ref LIKE 'fep_match_%'` de cron-live. Trabajo
 *     de plomería, sin parser nuevo.
 *   · Si ninguno responde → World Skate no publica acta y hay que buscar otra
 *     vía (o aceptar que esa competición sólo tenga marcador).
 *
 * Prueba los mismos candidatos de endpoint que usa el scraper de la FEP, pero
 * contra el portal `worldskate`: SidgadClient reescribe `rfep_*` → `worldskate_*`.
 *
 * Uso (dentro del contenedor etl):
 *   npx tsx apps/scraper/src/scrapers/worldskate/wse-acta-probe.ts 3095 320
 */
import * as cheerio from 'cheerio';
import { SidgadClient, SIDGAD_LANG } from '../fep/sidgad-client.js';
import { parseFicha, parseLiveHeader, parseTeamFouls, parseLineups } from '../fep/fep-ficha.parser.js';

const idp = process.argv[2] ?? '3095';
const idc = process.argv[3] ?? '320';

const client = new SidgadClient({
  baseUrl: 'https://www.server2.sidgad.es/worldskate',
  portalPrefix: 'worldskate',
  referer: 'https://wse.sidgad.com/',
});

// Mismos candidatos que FepFichaScraper. El cliente los reescribe al portal.
const CANDIDATOS: { path: string; body: Record<string, string> }[] = [
  { path: `rfep_gr_${idp}_1.php`,           body: { idm: '1', idc, idp, tab: 'tab_ficha_resumen' } },
  { path: `rfep_acta_idc_${idc}_1.php`,     body: { idp, idc, site_lang: SIDGAD_LANG } },
  { path: `rfep_acta_eli_idc_${idc}_1.php`, body: { id_partido: idp, idc, site_lang: SIDGAD_LANG } },
];

void (async () => {
  console.log(`\n→ Buscando acta de idp=${idp} idc=${idc} en el portal worldskate\n`);

  for (const c of CANDIDATOS) {
    const url = c.path.replace(/^rfep_/, 'worldskate_');
    try {
      const html = await client.post(c.path, c.body);
      const $ = cheerio.load(html);
      const filas = $('tr').filter((_, tr) => $(tr).find('.game_view_indcidencias_period').length > 0);

      console.log(`✓ ${url} → ${html.length} bytes, ${filas.length} filas de incidencia`);

      if (filas.length === 0) {
        console.log('   (responde, pero sin la estructura de incidencias)\n');
        continue;
      }

      // El parser REAL de la FEP, sobre el HTML de World Skate.
      const eventos = parseFicha(html, idp);
      const tipos = eventos.reduce<Record<string, number>>((a, e) => {
        a[e.eventType] = (a[e.eventType] ?? 0) + 1; return a;
      }, {});

      console.log(`\n   🎯 parseFicha extrae ${eventos.length} eventos:`, JSON.stringify(tipos));
      console.log('   cabecera en vivo:', JSON.stringify(parseLiveHeader(html)));
      console.log('   faltas de equipo:', JSON.stringify(parseTeamFouls(html)));
      console.log('   alineaciones:', parseLineups(html, idp).length, 'jugadores');
      console.log('\n   primeros eventos:');
      for (const e of eventos.slice(0, 6)) {
        console.log(`     ${e.eventType.padEnd(12)} P${e.period ?? '?'} ${e.clock ?? '--:--'} ` +
                    `${e.isHome === true ? 'local' : e.isHome === false ? 'visit' : '  ?  '} ` +
                    `${e.playerName ?? ''}  [${e.sourceRef}]`);
      }
      console.log('\n✅ World Skate sirve acta y el parser de la FEP la entiende.');
      console.log('   → basta con inyectar el portal y quitar el filtro fep_match_%\n');
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`✗ ${url} → ${msg}`);
    }
  }

  console.log('\n❌ Ningún endpoint devolvió acta con incidencias.');
  console.log('   World Skate podría no publicarla, o usar otra ruta. Habría que');
  console.log('   inspeccionar la petición real desde el navegador en wse.sidgad.com.\n');
})();

/**
 * Guarda páginas reales de la fuente como un CASO de la batería
 * (`apps/scraper/casos-reales/<caso>/`). Usa el mismo cliente sidgad que los
 * scrapers (sesión, cabeceras, reintentos), así que la página guardada es la
 * que vería producción.
 *
 * Se lanza desde una máquina con acceso a sidgad (tu PC o el servidor):
 *
 *   npx tsx apps/scraper/src/casos-reales/capturar.ts \
 *     --caso=fep-ok-liga-masculina-2026-27 --fuente=fep --idc=3590,3601 \
 *     --descripcion="OK Liga masculina 2026/27: liga + playoff"
 *
 *   # World Skate: calendario + match center del mismo instante
 *   npx tsx apps/scraper/src/casos-reales/capturar.ts \
 *     --caso=wse-europeo-sub17-2027 --fuente=wse --idc=340 --zona=Europe/Lisbon
 *
 *   # Feed de directo FEP (en un momento con partidos en juego)
 *   npx tsx apps/scraper/src/casos-reales/capturar.ts --caso=fep-feed-directo-<fecha> --fuente=fep --feed
 *
 * Escribe los HTML y un `caso.json` sin `formato`: complétalo a mano con el
 * formato que dicen las NORMAS de la competición antes de aprobar el caso.
 * Después: `npm run casos:actualizar --workspace=apps/scraper` y revisar el diff.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SidgadClient } from '../scrapers/fep/sidgad-client.js';
import { sourceByKey } from '../core/sources.js';

function args(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of process.argv.slice(2)) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    if (m) out[m[1]!] = m[2] ?? 'true';
  }
  return out;
}

async function main(): Promise<void> {
  const a = args();
  const caso = a['caso'];
  const fuente = a['fuente'] ?? 'fep';
  if (!caso || !/^[a-z0-9-]+$/.test(caso)) throw new Error('--caso=<nombre-en-kebab-case> es obligatorio');

  const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '../../casos-reales', caso);
  if (existsSync(join(raiz, 'caso.json')) && a['sobrescribir'] !== 'true') {
    throw new Error(`El caso ${caso} ya existe (usa --sobrescribir para recapturarlo)`);
  }
  mkdirSync(raiz, { recursive: true });

  const source = sourceByKey(fuente);
  const client = new SidgadClient(source.client);
  const capturado = new Date().toISOString();
  const base = { descripcion: a['descripcion'] ?? caso, capturado };

  if (a['feed'] === 'true') {
    const html = await client.post('rfep_mc_1.php', {});
    writeFileSync(join(raiz, 'feed.html'), html);
    writeFileSync(join(raiz, 'caso.json'), `${JSON.stringify({
      ...base, fuente: `${source.client.baseUrl}/${source.client.portalPrefix}_mc_1.php`, tipo: 'feed-fep', fichero: 'feed.html',
    }, null, 2)}\n`);
  } else {
    const idcs = (a['idc'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (idcs.length === 0) throw new Error('--idc=<idc>[,<idc>…] es obligatorio');
    const ficheros: string[] = [];
    for (const idc of idcs) {
      const html = await client.post(`rfep_cal_idc_${idc}_1.php`, { idc, site_lang: 'es' });
      const f = `cal_${idc}.html`;
      writeFileSync(join(raiz, f), html);
      ficheros.push(f);
    }
    const fuenteTxt = `${source.client.referer} (idc ${idcs.join(', ')})`;
    if (fuente === 'wse') {
      const mc = await client.post('rfep_mc_1.php', {});
      writeFileSync(join(raiz, 'mc.html'), mc);
      writeFileSync(join(raiz, 'caso.json'), `${JSON.stringify({
        ...base, fuente: fuenteTxt, tipo: 'worldskate', calendario: ficheros[0], matchCenter: 'mc.html',
        zona: a['zona'] ?? 'Europe/Madrid', formato: 'COMPLETAR: formato según las normas',
      }, null, 2)}\n`);
    } else {
      writeFileSync(join(raiz, 'caso.json'), `${JSON.stringify({
        ...base, fuente: fuenteTxt, tipo: 'calendario', portal: fuente, ficheros,
        formato: 'COMPLETAR: formato según las normas',
      }, null, 2)}\n`);
    }
  }
  console.log(`Caso guardado en ${raiz}. Completa "formato" en caso.json y ejecuta npm run casos:actualizar.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

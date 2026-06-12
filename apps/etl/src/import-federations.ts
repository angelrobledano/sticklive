/**
 * ORQUESTADOR MULTI-FEDERACIÓN.
 *
 * Por cada federación del registro (federations.ts):
 *   1. Descarga su catálogo de competiciones (fetch directo a sidgad con
 *      cabeceras de navegador — sin Playwright; los ids de temporada son
 *      compartidos y se resuelven por fórmula).
 *   2. Siembra competiciones/temporadas/equipos (import-history).
 *   3. Con --run: scrapea calendario + clasificación de cada temporada.
 *
 * Pensado para correr desde el PC (IP residencial) contra la BD del
 * servidor vía túnel SSH (DATABASE_URL apuntando al túnel).
 *
 * Uso:
 *   npx tsx --env-file=../../.env src/import-federations.ts            # solo catálogos + siembra
 *   npx tsx --env-file=../../.env src/import-federations.ts --run      # + scraping completo
 *   npx tsx --env-file=../../.env src/import-federations.ts --only=fap # una federación
 */
import * as cheerio from 'cheerio';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { FEDERATIONS, seasonLabelFromTempId, type Federation } from './federations.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CATALOG_DIR = resolve(HERE, '../../scraper/logs');

async function fetchCatalog(fed: Federation) {
  const url = `https://www.server2.sidgad.es/${fed.prefix}/${fed.prefix}_ls_1.php`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Referer': fed.referer,
      'Origin': fed.referer.replace(/\/$/, ''),
      'X-Requested-With': 'XMLHttpRequest',
      'Accept': 'text/html,*/*;q=0.8',
    },
  });
  if (!res.ok) throw new Error(`${fed.prefix}_ls_1.php → HTTP ${res.status}`);
  const html = await res.text();
  if (html.length < 500) throw new Error(`${fed.prefix}: respuesta sospechosamente corta (${html.length}b) — ¿requiere sesión de navegador?`);

  const $ = cheerio.load(html);
  const competitions: unknown[] = [];
  $('a.idc_master').each((_, el) => {
    const $el = $(el);
    const idc = $el.attr('id') ?? '';
    if (!idc) return;
    const tempMatch = ($el.attr('class') ?? '').match(/temp_(\d{1,5})/);
    const tempId = tempMatch ? tempMatch[1]! : null;
    const teamsVal = $el.find(`input#teams_array_${idc}`).attr('value') ?? '';
    const teams = teamsVal.split(';').filter(Boolean).map((chunk) => {
      const [logo = '', ref = '', abbr = '', ...nameParts] = chunk.split(',');
      return { logo, ref, abbr, name: nameParts.join(',').trim() };
    }).filter((t) => t.ref && t.name);
    competitions.push({
      idc,
      name: ($el.attr('name') ?? $el.attr('idc_name') ?? '').trim(),
      tempId,
      seasonLabel: tempId ? seasonLabelFromTempId(tempId) : null,
      logo: $el.attr('logo') ?? null,
      teamCount: teams.length,
      teams,
      config: $el.attr('config_params') || null,
    });
  });

  return competitions;
}

async function main() {
  const args = process.argv.slice(2);
  const doRun = args.includes('--run');
  const only = args.find((a) => a.startsWith('--only='))?.split('=')[1];

  const feds = FEDERATIONS.filter((f) => !only || f.prefix === only);
  mkdirSync(CATALOG_DIR, { recursive: true });

  for (const fed of feds) {
    console.log(`\n════════ ${fed.org} (${fed.region}) ════════`);
    try {
      // 1. Catálogo
      const competitions = await fetchCatalog(fed);
      const catalogPath = join(CATALOG_DIR, `${fed.prefix}-catalog.json`);
      writeFileSync(catalogPath, JSON.stringify({
        fetchedAt: new Date().toISOString(),
        competitionCount: competitions.length,
        competitions,
      }, null, 2));
      console.log(`📦 ${competitions.length} competiciones → ${catalogPath}`);
      if (competitions.length === 0) {
        console.log('⚠️  Catálogo vacío — esta federación quizá requiere el probe con navegador. Saltando.');
        continue;
      }

      // 2/3. Siembra (+ scraping con --run) — reutiliza import-history
      execSync(
        `npx tsx src/import-history.ts --catalog=${catalogPath} --org=${fed.org} --region=${fed.region}${doRun ? ' --run' : ''}`,
        {
          cwd: HERE.replace(/src$/, ''),
          stdio: 'inherit',
          env: {
            ...process.env,
            SIDGAD_PORTAL: fed.prefix,
            SIDGAD_REFERER: fed.referer,
          },
        }
      );
    } catch (err) {
      console.error(`❌ ${fed.org} falló:`, err instanceof Error ? err.message : err);
      console.error('   Continuando con la siguiente federación.');
    }
  }

  console.log('\n🏁 Federaciones procesadas.');
}

main().catch((err) => { console.error('❌', err); process.exit(1); });

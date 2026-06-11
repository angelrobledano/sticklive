/**
 * CATÁLOGO COMPLETO de competiciones RFEP — todas las temporadas.
 *
 * rfep_ls_1.php devuelve TODAS las competiciones de TODAS las temporadas
 * en una sola respuesta, pero solo dentro de la sesión del portal: aquí
 * cargamos la home con Playwright y capturamos esa respuesta de red.
 *
 * El mapeo temp_XXXX → "Temporada YYYY/YY" se extrae del menú de la home
 * volcando los atributos del propio nodo y sus ancestros (suele ir en
 * onclick/class/id de alguno de ellos).
 *
 * Salida: logs/fep-catalog.json (+ logs/fep-season-menu-debug.json si el
 * mapeo de temporadas no se resuelve, para inspección manual).
 *
 * Uso: npx tsx src/scrapers/fep/fep-catalog.ts
 */
import { chromium } from 'playwright';
import * as cheerio from 'cheerio';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// Portal parametrizable: --home=https://www.hockeypatines.fmp.es/ --prefix=fmp
const argv = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
    const [k, ...v] = a.slice(2).split('=');
    return [k, v.join('=')];
  })
);
const HOME = argv['home'] ?? 'https://www.hockeypatines.fep.es/';
const PREFIX = argv['prefix'] ?? 'fep';

interface CatalogTeam {
  logo: string;
  ref: string;     // id sidgad del equipo
  abbr: string;
  name: string;
}

interface CatalogCompetition {
  idc: string;
  name: string;
  tempId: string | null;
  seasonLabel: string | null;
  logo: string | null;
  teamCount: number;
  teams: CatalogTeam[];
  config: string | null;
}

async function main() {
  console.log('🔍 Cargando portal y capturando rfep_ls...');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  let lsBody: string | null = null;
  page.on('response', async (response) => {
    if (!/_ls/.test(response.url()) || !response.url().includes('sidgad')) return;
    try {
      const text = await response.text();
      // Quedarnos con la respuesta más completa
      if (!lsBody || text.length > lsBody.length) lsBody = text;
    } catch { /* noop */ }
  });

  await page.goto(HOME, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(6_000);

  // Si aún no se disparó, abrir la sección de competiciones / clicar una temporada
  if (!lsBody) {
    console.log('→ rfep_ls no disparado en carga; forzando vía menú...');
    await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll('a, li, span, div'));
      const t = nodes.find((el) => /^Temporada \d{4}\/\d{2}$/.test((el.textContent ?? '').trim()));
      (t as HTMLElement | undefined)?.click();
    });
    await page.waitForTimeout(5_000);
  }

  // ── Mapeo temp_XXXX → etiqueta de temporada ────────────────────────────────
  // Volcamos nodo + 3 ancestros de cada item del menú para cazar el id
  const menuDump = await page.evaluate(() => {
    const out: Array<{ label: string; chain: string[] }> = [];
    const seen = new Set<string>();
    for (const el of Array.from(document.querySelectorAll('a, li, span, div'))) {
      const label = (el.textContent ?? '').trim();
      if (!/^Temporada \d{4}\/\d{2}$/.test(label) || seen.has(label)) continue;
      // Solo nodos hoja (sin hijos con el mismo texto)
      if (el.children.length > 0 &&
          Array.from(el.children).some((c) => (c.textContent ?? '').trim() === label)) continue;
      seen.add(label);
      const chain: string[] = [];
      let cur: Element | null = el;
      for (let i = 0; i < 4 && cur; i++) {
        const attrs = Array.from(cur.attributes).map((a) => `${a.name}="${a.value}"`).join(' ');
        chain.push(`<${cur.tagName.toLowerCase()} ${attrs}>`);
        cur = cur.parentElement;
      }
      out.push({ label, chain });
    }
    return out;
  });

  const seasonMap: Record<string, string> = {};
  for (const { label, chain } of menuDump) {
    for (const html of chain) {
      // El menú usa <a id="temp_39" id_temp="39" temp_name="2025/26">
      const m = html.match(/id_temp="(\d{1,5})"/i)
        ?? html.match(/temp[_\-="']{1,3}(\d{1,5})/i);
      if (m) { seasonMap[m[1]!] = label; break; }
    }
  }

  console.log(`   ${Object.keys(seasonMap).length} temporadas mapeadas`);
  Object.entries(seasonMap)
    .sort((a, b) => Number(b[0]) - Number(a[0]))
    .forEach(([id, l]) => console.log(`     temp_${id} → ${l}`));

  await browser.close();

  mkdirSync(join(process.cwd(), 'logs'), { recursive: true });

  if (Object.keys(seasonMap).length === 0) {
    writeFileSync(join(process.cwd(), 'logs', `${PREFIX}-season-menu-debug.json`),
      JSON.stringify(menuDump, null, 2));
    console.log('   ⚠️  Mapeo vacío — volcado del menú en logs/fep-season-menu-debug.json');
  }

  // ── Parsear catálogo ───────────────────────────────────────────────────────
  if (!lsBody) {
    console.error('❌ No se capturó la respuesta de rfep_ls. Abortando.');
    process.exit(1);
  }
  const bodyText: string = lsBody;
  console.log(`\n🔍 Parseando catálogo (${(bodyText.length / 1024).toFixed(0)} KB)...`);
  const $ = cheerio.load(bodyText);

  const competitions: CatalogCompetition[] = [];
  $('a.idc_master').each((_, el) => {
    const $el = $(el);
    const idc = $el.attr('id') ?? '';
    if (!idc) return;
    const cls = $el.attr('class') ?? '';
    const tempMatch = cls.match(/temp_(\d{1,5})/);
    const tempId = tempMatch ? tempMatch[1]! : null;
    const teamsVal = $el.find(`input#teams_array_${idc}`).attr('value') ?? '';
    // Formato: "logo.png,1611,AND,ANDORRA;420.png,1612,AUT,AUSTRIA;..."
    const teams = teamsVal.split(';').filter(Boolean).map((chunk) => {
      const [logo = '', ref = '', abbr = '', ...nameParts] = chunk.split(',');
      return { logo, ref, abbr, name: nameParts.join(',').trim() };
    }).filter((t) => t.ref && t.name);
    competitions.push({
      idc,
      name: ($el.attr('name') ?? $el.attr('idc_name') ?? '').trim(),
      tempId,
      seasonLabel: tempId ? seasonMap[tempId] ?? null : null,
      logo: $el.attr('logo') ?? null,
      teamCount: teams.length,
      teams,
      config: $el.attr('config_params') || null,
    });
  });

  console.log(`   ${competitions.length} competiciones encontradas.`);

  const bySeason = new Map<string, number>();
  for (const c of competitions) {
    const key = c.seasonLabel ?? `temp_${c.tempId ?? '?'}`;
    bySeason.set(key, (bySeason.get(key) ?? 0) + 1);
  }
  console.log('\n📊 Competiciones por temporada:');
  Array.from(bySeason.entries()).sort().forEach(([s, n]) => console.log(`   ${s}: ${n}`));

  const out = join(process.cwd(), 'logs', `${PREFIX}-catalog.json`);
  writeFileSync(out, JSON.stringify({
    fetchedAt: new Date().toISOString(),
    seasons: Object.entries(seasonMap).map(([tempId, label]) => ({ tempId, label })),
    competitionCount: competitions.length,
    competitions,
  }, null, 2));
  console.log(`\n✅ Catálogo guardado en: ${out}`);
}

main().catch((err) => { console.error('❌', err); process.exit(1); });

/**
 * HERRAMIENTA DE DIAGNÓSTICO — descubrir de dónde salen las fotos de jugador.
 *
 * Abre el playoff, entra a la ficha de un partido, pincha en un jugador
 * (link player_season_stats) y captura tanto las peticiones de red como
 * las <img> que aparecen en el DOM tras el click.
 *
 * Uso:
 *   npx tsx apps/scraper/src/scrapers/fep/fep-player-photo-probe.ts [idp]
 *   (idp por defecto: 34277)
 *
 * Salida: logs/player-photo-probe.json + resumen por consola.
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const IDP = process.argv[2] ?? '34277';
const LEAGUE_URL = 'https://www.hockeypatines.fep.es/league/3481';

interface Entry {
  kind: 'request' | 'dom-img';
  url: string;
  method?: string;
  postData?: string | null;
  status?: number;
  contentType?: string;
  phase: string;
}

async function probe() {
  console.log(`🔍 Sonda de fotos de jugador — partido idp=${IDP}\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  const entries: Entry[] = [];
  let phase = 'carga-inicial';

  page.on('response', async (response) => {
    const url = response.url();
    if (/google|analytics|facebook|doubleclick|mathtag|neodata|adform|civiccomputing/.test(url)) return;
    // Nos interesan imágenes y PHPs
    const ct = response.headers()['content-type'] ?? '';
    if (!/image|php/.test(url) && !ct.includes('image')) return;
    entries.push({
      kind: 'request',
      url,
      method: response.request().method(),
      postData: response.request().postData(),
      status: response.status(),
      contentType: ct,
      phase,
    });
  });

  console.log(`→ Cargando ${LEAGUE_URL} ...`);
  await page.goto(LEAGUE_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(5_000);

  // Abrir calendario y ficha del partido
  phase = 'calendario';
  const calBtn = page.locator('[acceso="calendario_btn"]').first();
  if (await calBtn.count()) { await calBtn.click().catch(() => {}); await page.waitForTimeout(3_000); }

  phase = 'ficha-partido';
  const report = page.locator(`i.game_report[idp="${IDP}"]`).last();
  if (await report.count()) {
    console.log(`→ Abriendo ficha del partido ${IDP}...`);
    await report.click({ force: true }).catch(() => {});
    await page.waitForTimeout(5_000);
  } else {
    console.log('⚠️  No se encontró el partido en el calendario');
  }

  // Pinchar en el primer jugador con id_player real
  phase = 'click-jugador';
  const playerLink = page.locator('a.player_season_stats[id_player]:not([id_player="0"])').first();
  if (await playerLink.count()) {
    const idPlayer = await playerLink.getAttribute('id_player');
    const name = (await playerLink.textContent())?.replace(/\s+/g, ' ').trim();
    console.log(`→ Click en jugador id_player=${idPlayer} (${name})...`);
    await playerLink.click({ force: true }).catch((e) => console.log('  (click falló:', String(e).slice(0, 100), ')'));
    await page.waitForTimeout(6_000);

    // Capturar todas las <img> visibles tras el click (el popup de stats)
    const imgs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('img'))
        .map((i) => i.src)
        .filter((src) => src && !/logos_clubes|logos_competiciones|portales_files/.test(src))
    );
    for (const url of [...new Set(imgs)]) entries.push({ kind: 'dom-img', url, phase });
  } else {
    console.log('⚠️  Ningún link de jugador con id_player en la ficha');
  }

  await browser.close();

  const outDir = join(process.cwd(), 'logs');
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, 'player-photo-probe.json');
  writeFileSync(outFile, JSON.stringify(entries, null, 2), 'utf-8');
  console.log(`\n📄 ${entries.length} entradas → ${outFile}\n`);

  console.log('═══ Candidatas a foto de jugador ═══');
  const candidates = entries.filter(
    (e) => e.phase === 'click-jugador' && /jugador|player|foto|photo|\.jpg|\.jpeg|\.png/i.test(e.url)
  );
  for (const c of candidates) {
    console.log(`${c.kind === 'dom-img' ? 'IMG' : (c.method ?? 'GET')} ${c.url}`);
    if (c.postData) console.log(`  body: ${c.postData}`);
  }
  if (candidates.length === 0) console.log('(ninguna obvia — revisa el JSON completo)');
}

probe().catch((err) => { console.error('❌', err); process.exit(1); });

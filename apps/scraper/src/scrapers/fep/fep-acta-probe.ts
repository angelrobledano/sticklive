/**
 * HERRAMIENTA DE DIAGNÓSTICO — descubrir el endpoint de la ficha/acta del playoff.
 *
 * Navega a la página del playoff en hockeypatines.fep.es, abre el calendario,
 * pincha en el partido objetivo y captura todas las peticiones de red que se
 * disparan al abrir la ficha. El endpoint real del acta aparecerá entre ellas.
 *
 * Uso:
 *   npx tsx apps/scraper/src/scrapers/fep/fep-acta-probe.ts [idp]
 *   (idp por defecto: 34277 — BAR vs IHC del 09/06)
 *
 * Salida: logs/acta-probe.json + resumen por consola.
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const IDP = process.argv[2] ?? '34277';
const LEAGUE_URL = 'https://www.hockeypatines.fep.es/league/3481';

interface NetworkEntry {
  url: string;
  method: string;
  postData: string | null;
  status: number;
  contentType: string;
  size: number;
  bodyPreview?: string;
  phase: string; // en qué fase de la navegación ocurrió
}

async function probe() {
  console.log(`🔍 Sonda de acta — idp=${IDP}\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  const entries: NetworkEntry[] = [];
  let phase = 'carga-inicial';

  page.on('response', async (response) => {
    const url = response.url();
    if (/google|analytics|facebook|doubleclick/.test(url)) return;
    if (/\.(png|jpg|jpeg|gif|ico|svg|woff2?|css|js)(\?|$)/i.test(url)) return;

    let size = 0;
    let bodyPreview: string | undefined;
    try {
      const body = await response.body();
      size = body.length;
      // Guardar preview de respuestas PHP/JSON — ahí estará el acta
      if (/\.php/.test(url) && size > 0 && size < 200_000) {
        bodyPreview = body.toString('utf-8').slice(0, 600);
      }
    } catch { /* respuestas ya cerradas */ }

    entries.push({
      url,
      method: response.request().method(),
      postData: response.request().postData(),
      status: response.status(),
      contentType: response.headers()['content-type'] ?? '',
      size,
      bodyPreview,
      phase,
    });
  });

  console.log(`→ Cargando ${LEAGUE_URL} ...`);
  await page.goto(LEAGUE_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(6_000);

  // Abrir el calendario de la competición (si hay botón)
  phase = 'calendario';
  const CAL_SELECTORS = ['[acceso="calendario_btn"]', '.calendario_btn'];
  let calClicked = false;
  for (const sel of CAL_SELECTORS) {
    const btn = page.locator(sel).first();
    if (await btn.count()) {
      console.log(`→ Abriendo calendario (${sel})...`);
      await btn.click().catch(() => {});
      calClicked = true;
      break;
    }
  }
  if (!calClicked) {
    const byText = page.getByText('CALENDARIO', { exact: false }).first();
    if (await byText.count()) {
      console.log('→ Abriendo calendario (por texto)...');
      await byText.click().catch(() => {});
      calClicked = true;
    }
  }
  if (calClicked) await page.waitForTimeout(4_000);

  // Capturar también popups/pestañas nuevas que abra el click
  context.on('page', async (popup) => {
    console.log(`🪟 Popup abierto: ${popup.url()}`);
    popup.on('response', async (response) => {
      const url = response.url();
      if (/google|analytics|facebook|doubleclick|mathtag|neodata|adform/.test(url)) return;
      let size = 0; let bodyPreview: string | undefined;
      try {
        const body = await response.body();
        size = body.length;
        if (size > 0 && size < 200_000) bodyPreview = body.toString('utf-8').slice(0, 600);
      } catch { /* noop */ }
      entries.push({
        url, method: response.request().method(),
        postData: response.request().postData(),
        status: response.status(),
        contentType: response.headers()['content-type'] ?? '',
        size, bodyPreview, phase: `popup-${phase}`,
      });
    });
  });

  // Pinchar el icono de ACTA (game_report) del partido en el calendario,
  // no el marcador del carrusel.
  phase = `click-partido-${IDP}`;
  const REPORT_SELECTORS = [
    `i.game_report[idp="${IDP}"]`,
    `.game_report[idp="${IDP}"]`,
    `tr [idp="${IDP}"]`,
    `[idp="${IDP}"]`,
  ];
  let clicked = false;
  for (const sel of REPORT_SELECTORS) {
    const el = page.locator(sel).last(); // .last(): el del calendario, no el del carrusel
    if (await el.count()) {
      // Volcar el elemento para ver cómo construye la URL de la ficha
      const html = await el.evaluate((node) => (node as HTMLElement).outerHTML).catch(() => '');
      const onclick = await el.evaluate((node) => (node as HTMLElement).getAttribute('onclick')).catch(() => null);
      console.log(`→ Elemento encontrado (${sel}):\n  outerHTML: ${html.slice(0, 300)}\n  onclick: ${onclick}`);
      console.log('→ Click...');
      await el.click({ force: true }).catch((e) => console.log('  (click falló:', String(e).slice(0, 120), ')'));
      clicked = true;
      await page.waitForTimeout(8_000);
      console.log(`  URL actual tras click: ${page.url()}`);
      break;
    }
  }
  if (!clicked) console.log(`⚠️  No se encontró ningún elemento con idp=${IDP}`);

  await browser.close();

  // ── Informe ────────────────────────────────────────────────────────────
  const outDir = join(process.cwd(), 'logs');
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, 'acta-probe.json');
  writeFileSync(outFile, JSON.stringify(entries, null, 2), 'utf-8');

  console.log(`\n📄 ${entries.length} peticiones capturadas → ${outFile}\n`);

  // Candidatos: PHPs solicitados tras el click (fase click-partido)
  const candidates = entries.filter(
    (e) => e.phase.startsWith('click-partido') && /\.php/.test(e.url) && e.status === 200
  );
  console.log('═══ Candidatos a endpoint de acta (tras el click) ═══');
  for (const c of candidates) {
    console.log(`\n${c.method} ${c.url}`);
    if (c.postData) console.log(`  body: ${c.postData}`);
    console.log(`  ${c.status} · ${c.size} bytes · ${c.contentType}`);
    if (c.bodyPreview) console.log(`  preview: ${c.bodyPreview.replace(/\s+/g, ' ').slice(0, 200)}`);
  }
  if (candidates.length === 0) {
    console.log('(ninguno — revisa logs/acta-probe.json entero, puede que el click no abriera la ficha)');
  }
}

probe().catch((err) => { console.error('❌', err); process.exit(1); });

/**
 * HERRAMIENTA DE DESCUBRIMIENTO — Histórico de competiciones
 *
 * Recorre el menú de temporadas de hockeypatines.fep.es (1999/00 → hoy),
 * selecciona cada temporada y extrae las competiciones disponibles con su
 * idc (el identificador que consume nuestro pipeline vía rfep_cal_idc_*).
 *
 * Estrategia doble por temporada:
 *   1. Red: capturar peticiones a sidgad que lleven idc en la URL.
 *   2. DOM: volcar anchors/onclicks que referencien idc tras renderizar.
 *
 * Salida: logs/history-probe.json
 *   { seasons: [{ label, competitions: [{ name, idc, source }] }] }
 *
 * Uso: npx tsx src/scrapers/fep/fep-history-probe.ts
 */
import { chromium, type Page } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

interface CompetitionRef {
  name: string;
  idc: string;
  source: 'network' | 'dom';
}

interface SeasonReport {
  label: string;
  competitions: CompetitionRef[];
  rawUrls: string[];
  lsCalls?: Array<{ url: string; postData: string | null; bodyPreview: string | null }>;
}

const IDC_RE = /idc[_=]?(\d{2,6})/i;

function extractIdc(s: string): string | null {
  const m = s.match(IDC_RE);
  return m ? m[1]! : null;
}

async function scrapeDomCompetitions(page: Page): Promise<CompetitionRef[]> {
  // Anchors y elementos con onclick que referencien idc
  return page.evaluate(() => {
    const found: { name: string; idc: string; source: 'dom' }[] = [];
    const idcRe = /idc[_=]?(\d{2,6})/i;
    const nodes = Array.from(document.querySelectorAll('a, [onclick], [data-idc]'));
    for (const el of nodes) {
      const href = el.getAttribute('href') ?? '';
      const onclick = el.getAttribute('onclick') ?? '';
      const dataIdc = el.getAttribute('data-idc') ?? '';
      const hay = `${href} ${onclick} ${dataIdc}`;
      const m = hay.match(idcRe);
      if (!m) continue;
      const name = (el.textContent ?? '').trim().replace(/\s+/g, ' ');
      if (!name || name.length > 120) continue;
      found.push({ name, idc: m[1]!, source: 'dom' });
    }
    return found;
  });
}

async function probe() {
  console.log('🔍 Sondeando histórico de temporadas en hockeypatines.fep.es...\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  // Captura de red compartida; cada temporada limpia y rellena su buffer.
  // Para rfep_ls_1.php (el listado de competiciones) guardamos además el
  // cuerpo del POST y la respuesta completa: ahí viven los idc.
  let netBuffer: { url: string; postData?: string | null; body?: string }[] = [];
  page.on('response', async (response) => {
    const url = response.url();
    if (!url.includes('sidgad')) return;
    const entry: { url: string; postData?: string | null; body?: string } = { url };
    if (url.includes('rfep_ls')) {
      entry.postData = response.request().postData();
      try { entry.body = (await response.text()).slice(0, 200_000); } catch { /* noop */ }
    }
    netBuffer.push(entry);
  });

  await page.goto('https://www.hockeypatines.fep.es/', {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await page.waitForTimeout(6_000);

  // Localizar el menú de temporadas
  const seasonLabels: string[] = await page.evaluate(() => {
    const labels = new Set<string>();
    for (const el of Array.from(document.querySelectorAll('a, li, span, div'))) {
      const t = (el.textContent ?? '').trim();
      if (/^Temporada \d{4}\/\d{2}$/.test(t)) labels.add(t);
    }
    return Array.from(labels);
  });

  console.log(`→ Temporadas detectadas: ${seasonLabels.length}`);
  seasonLabels.forEach((s) => console.log(`   · ${s}`));

  const seasons: SeasonReport[] = [];

  for (const label of seasonLabels) {
    console.log(`\n→ Seleccionando "${label}"...`);
    netBuffer = [];
    try {
      // Click nativo vía JS: los items del menú de temporadas están en un
      // desplegable oculto y el click de Playwright exige visibilidad.
      const clicked = await page.evaluate((lbl) => {
        const nodes = Array.from(document.querySelectorAll('a, li, span, div'));
        // Preferir el nodo más profundo cuyo texto sea EXACTAMENTE la etiqueta
        const exact = nodes.filter((el) => (el.textContent ?? '').trim() === lbl);
        const target = exact[exact.length - 1] as HTMLElement | undefined;
        if (!target) return false;
        target.click();
        return true;
      }, label);
      if (!clicked) throw new Error('No se encontró el nodo de la temporada');
      await page.waitForTimeout(5_000);

      // Si hay un botón/sección "Competiciones", abrirla para forzar la carga
      try {
        const comp = page.locator('text=COMPETICIONES').first();
        if (await comp.isVisible({ timeout: 2_000 })) {
          await comp.click();
          await page.waitForTimeout(3_000);
        }
      } catch { /* opcional */ }

      const fromDom = await scrapeDomCompetitions(page);
      const fromNet: CompetitionRef[] = netBuffer
        .map((e) => ({ idc: extractIdc(e.url), url: e.url }))
        .filter((e): e is { idc: string; url: string } => !!e.idc)
        .map((e) => ({ name: `(red) ${e.url.split('/').pop()}`, idc: e.idc, source: 'network' as const }));

      // idc embebidos en el HTML devuelto por rfep_ls (listado de competiciones)
      for (const e of netBuffer) {
        if (!e.body) continue;
        const re = /idc[_="']+(\d{2,6})/gi;
        let m: RegExpExecArray | null;
        while ((m = re.exec(e.body)) !== null) {
          fromNet.push({ name: `(ls) idc=${m[1]}`, idc: m[1]!, source: 'network' });
        }
      }

      // Dedupe por idc, prioridad al DOM (trae el nombre legible)
      const byIdc = new Map<string, CompetitionRef>();
      for (const c of [...fromNet, ...fromDom]) byIdc.set(c.idc, c);

      const competitions = Array.from(byIdc.values());
      console.log(`   ${competitions.length} competiciones con idc`);
      competitions.slice(0, 8).forEach((c) => console.log(`     idc=${c.idc} ${c.name}`));

      seasons.push({
        label,
        competitions,
        rawUrls: netBuffer.map((e) => e.url).slice(0, 60),
        lsCalls: netBuffer
          .filter((e) => e.url.includes('rfep_ls'))
          .map((e) => ({ url: e.url, postData: e.postData ?? null, bodyPreview: e.body?.slice(0, 4000) ?? null })),
      } as SeasonReport);
    } catch (err) {
      console.log(`   ⚠️  Error en ${label}: ${err instanceof Error ? err.message : err}`);
      seasons.push({ label, competitions: [], rawUrls: netBuffer.map((e) => e.url).slice(0, 60) });
    }
  }

  await browser.close();

  mkdirSync(join(process.cwd(), 'logs'), { recursive: true });
  const reportPath = join(process.cwd(), 'logs', 'history-probe.json');
  writeFileSync(reportPath, JSON.stringify({
    probeDate: new Date().toISOString(),
    seasonCount: seasons.length,
    seasons,
  }, null, 2));

  console.log(`\n✅ Informe guardado en: ${reportPath}`);
  console.log('   Pásamelo y monto la ingesta del histórico a partir de él.');
}

probe().catch(console.error);

/**
 * HERRAMIENTA DE DIAGNÓSTICO — ¿expone sidgad fotos/ids del cuerpo técnico?
 *
 * El acta lista al staff como texto plano (sin id_player), así que la foto
 * no puede derivarse de ahí. Esta sonda abre la vista de club/equipo en
 * hockeypatines.fep.es y captura imágenes y peticiones tras navegar a la
 * plantilla, buscando un patrón tipo fichas/{id}_1.jpg para los técnicos.
 *
 * Uso: npx tsx apps/scraper/src/scrapers/fep/fep-staff-photo-probe.ts [idClub]
 *   idClub por defecto: 45 (Barça — atributo club_45 visto en los feeds)
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const ID_CLUB = process.argv[2] ?? '45';

interface Entry { kind: string; url: string; postData?: string | null; phase: string; text?: string }

async function probe() {
  console.log(`🔍 Sonda de staff — club ${ID_CLUB}\n`);
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  })).newPage();

  const entries: Entry[] = [];
  let phase = 'inicio';

  page.on('response', async (response) => {
    const url = response.url();
    if (/google|analytics|facebook|mathtag|neodata|adform/.test(url)) return;
    const ct = response.headers()['content-type'] ?? '';
    if (/\.php/.test(url) || ct.includes('image')) {
      entries.push({ kind: 'req', url, postData: response.request().postData(), phase });
    }
  });

  // Candidatas de URL de club en el portal
  const CANDIDATES = [
    `https://www.hockeypatines.fep.es/club/${ID_CLUB}`,
    `https://www.hockeypatines.fep.es/team/${ID_CLUB}`,
    `https://www.hockeypatines.fep.es/equipo/${ID_CLUB}`,
  ];

  for (const url of CANDIDATES) {
    phase = `goto-${url.split('/').slice(-2).join('/')}`;
    console.log(`→ Probando ${url} ...`);
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => null);
    if (!resp || resp.status() >= 400) { console.log(`  (${resp?.status() ?? 'sin respuesta'})`); continue; }
    await page.waitForTimeout(5_000);

    // Buscar pestañas/botones de plantilla o staff y pincharlos
    for (const text of ['PLANTILLA', 'EQUIPO', 'STAFF', 'TÉCNICOS', 'JUGADORES']) {
      const btn = page.getByText(text, { exact: false }).first();
      if (await btn.count()) {
        phase = `click-${text}`;
        console.log(`  → click "${text}"`);
        await btn.click({ force: true }).catch(() => {});
        await page.waitForTimeout(4_000);
      }
    }

    // Volcar imágenes del DOM que parezcan fichas de persona
    const imgs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('img'))
        .map((i) => ({ src: i.src, alt: i.alt ?? '' }))
        .filter(({ src }) => /ficha|tecnic|staff|persona|player/i.test(src))
    );
    for (const { src, alt } of imgs) entries.push({ kind: 'dom-img', url: src, text: alt, phase });

    if (imgs.length > 0) break; // ya tenemos material
  }

  await browser.close();

  const outFile = join(process.cwd(), 'logs', 'staff-photo-probe.json');
  mkdirSync(join(process.cwd(), 'logs'), { recursive: true });
  writeFileSync(outFile, JSON.stringify(entries, null, 2), 'utf-8');
  console.log(`\n📄 ${entries.length} entradas → ${outFile}\n`);

  console.log('═══ Candidatas (fichas/...) ═══');
  const hits = entries.filter((e) => /fichas\//.test(e.url));
  for (const h of hits) console.log(`${h.kind} [${h.phase}] ${h.url}`);
  if (hits.length === 0) console.log('(ninguna — pega el JSON si las URLs probadas devolvieron 404)');
}

probe().catch((err) => { console.error('❌', err); process.exit(1); });

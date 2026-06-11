/**
 * Sonda específica para capturar el endpoint de clasificación.
 * Navega a OK Liga y hace click en el botón #clasificaciones_btn.
 *
 * Uso: npx ts-node --esm apps/scraper/src/scrapers/fep/fep-clasif-probe2.ts
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

async function probe() {
  console.log('🔬 Capturando endpoint de clasificación...\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  interface Captured { url: string; method: string; postData: string | null; body: string; }
  const captured: Captured[] = [];

  await context.route(/sidgad/, async (route, request) => {
    const response = await route.fetch();
    const body = await response.text();
    if (request.url().includes('.php') && !request.url().includes('image')) {
      captured.push({
        url: request.url(),
        method: request.method(),
        postData: request.postData(),
        body: body.slice(0, 8000),
      });
      const short = request.url().replace('https://www.server2.sidgad.es/rfep/', '');
      console.log(`  ${request.method()} ${short} [${response.status()}] ${body.length}b`);
      if (request.postData()) console.log(`    POST: ${request.postData()}`);
    }
    await route.fulfill({ response, body });
  });

  // 1. Cargar página
  console.log('→ Cargando página...');
  await page.goto('https://www.hockeypatines.fep.es/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);

  // 2. Click Competiciones
  console.log('→ Abriendo Competiciones...');
  try {
    await page.locator('text=Competiciones').first().click();
    await page.waitForTimeout(3000);
  } catch { console.log('  ⚠️ No encontrado'); }

  // 3. Click en OK Liga (id=3150)
  console.log('→ Entrando en OK Liga (id=3150)...');
  try {
    await page.locator('[id="3150"]').first().click();
    await page.waitForTimeout(5000);
  } catch {
    try {
      await page.locator('text=OK LIGA MASCULINA').first().click();
      await page.waitForTimeout(5000);
    } catch { console.log('  ⚠️ No encontrado'); }
  }

  // 4. Click en botón CLASIFICACIONES (id="clasificaciones_btn")
  console.log('→ Haciendo click en CLASIFICACIONES...');
  try {
    const btn = page.locator('#clasificaciones_btn');
    if (await btn.isVisible({ timeout: 5000 })) {
      await btn.click();
      await page.waitForTimeout(5000);
      console.log('  ✅ Click realizado');
    } else {
      console.log('  ⚠️ Botón clasificaciones_btn no visible');
      // Intentar por texto
      await page.locator('text=CLASIFICACIONES').first().click();
      await page.waitForTimeout(5000);
    }
  } catch (e) { console.log(`  ⚠️ ${e}`); }

  await browser.close();

  console.log(`\n📊 PHP calls capturadas: ${captured.length}`);

  mkdirSync(join(process.cwd(), 'logs'), { recursive: true });

  // Guardar cada response en un archivo separado
  for (const c of captured) {
    if (c.body.length > 100) {
      const filename = c.url.split('/').pop()!.replace(/[?&=]/g, '_');
      writeFileSync(join(process.cwd(), 'logs', filename), c.body);
      console.log(`  Guardado: logs/${filename} (${c.body.length}b)`);
    }
  }

  writeFileSync(
    join(process.cwd(), 'logs', 'clasif-probe2.json'),
    JSON.stringify({ capturedAt: new Date().toISOString(), calls: captured }, null, 2)
  );
  console.log('\n✅ Informe: logs/clasif-probe2.json');
}

probe().catch(console.error);

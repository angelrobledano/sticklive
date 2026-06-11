/**
 * Captura el HTML COMPLETO de clasificación via Playwright (sin truncar).
 * Navega igual que probe2 pero guarda la respuesta entera.
 *
 * Uso: npx ts-node --esm apps/scraper/src/scrapers/fep/fep-clasif-probe4.ts
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

async function probe() {
  console.log('🔬 Capturando HTML completo de clasificación...\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  let clasifHtml = '';

  mkdirSync(join(process.cwd(), 'logs'), { recursive: true });
  const outPath = join(process.cwd(), 'logs', 'rfep_clasif_idc_3150_1_full.html');

  // Interceptar todas las llamadas a sidgad y guardar la de clasificación
  await context.route(/sidgad/, async (route, request) => {
    try {
      const response = await route.fetch();
      const body = await response.text();

      if (request.url().includes('rfep_clasif_idc')) {
        clasifHtml = body;
        // Guardar inmediatamente — antes de que browser.close() pueda interrumpir
        writeFileSync(outPath, body, 'utf-8');
        console.log(`  ✅ Clasificación capturada y guardada: ${body.length} bytes`);
      }

      await route.fulfill({ response, body });
    } catch (err) {
      // Ignorar errores de requests cancelados al cerrar el browser
      try { await route.abort(); } catch { /* ignorar */ }
    }
  });

  console.log('→ Cargando página...');
  await page.goto('https://www.hockeypatines.fep.es/', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForTimeout(5000);

  console.log('→ Abriendo Competiciones...');
  try {
    await page.locator('text=Competiciones').first().click();
    await page.waitForTimeout(3000);
  } catch {
    console.log('  ⚠️ No encontrado');
  }

  console.log('→ Entrando en OK Liga (id=3150)...');
  try {
    await page.locator('[id="3150"]').first().click();
    await page.waitForTimeout(5000);
  } catch {
    try {
      await page.locator('text=OK LIGA MASCULINA').first().click();
      await page.waitForTimeout(5000);
    } catch {
      console.log('  ⚠️ No encontrado');
    }
  }

  console.log('→ Click en CLASIFICACIONES...');
  try {
    const btn = page.locator('#clasificaciones_btn');
    if (await btn.isVisible({ timeout: 5000 })) {
      await btn.click();
      await page.waitForTimeout(5000);
      console.log('  ✅ Click realizado');
    } else {
      await page.locator('text=CLASIFICACIONES').first().click();
      await page.waitForTimeout(5000);
    }
  } catch (e) {
    console.log(`  ⚠️ ${e}`);
  }

  await browser.close();

  if (clasifHtml) {
    console.log(`\n✅ HTML completo guardado: ${outPath} (${clasifHtml.length} bytes)`);

    // Contar equipos
    const positions = [...clasifHtml.matchAll(/text-align: right[^>]*>(\d+)</g)];
    console.log(`   Equipos detectados: ${positions.length}`);
    positions.forEach(m => process.stdout.write(`  ${m[1]}`));
    if (positions.length) console.log();
  } else {
    console.log('\n❌ No se capturó el HTML de clasificación.');
    console.log('   Posible causa: el botón no se activó o la URL no contiene "rfep_clasif_idc".');
  }
}

probe().catch(console.error);

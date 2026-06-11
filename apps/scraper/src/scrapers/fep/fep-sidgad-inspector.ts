/**
 * INSPECTOR DE ENDPOINTS SIDGAD
 *
 * Segunda fase del diagnóstico. Sabemos que sidgad.es usa estos endpoints PHP:
 *   - POST https://www.server2.sidgad.es/public_docs/rfep/hp_feed.php
 *   - POST https://www.server2.sidgad.es/rfep/rfep_mc_1.php
 *   - GET  https://www.server2.sidgad.es/rfep/rfep_ls_1.php
 *
 * Este script captura el cuerpo exacto de los requests y responses
 * para entender qué parámetros aceptan y qué formato devuelven.
 *
 * Uso: npx ts-node --esm apps/scraper/src/scrapers/fep/fep-sidgad-inspector.ts
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const SIDGAD_ENDPOINTS = [
  'hp_feed.php',
  'rfep_mc_1.php',
  'rfep_ls_1.php',
];

interface InspectedRequest {
  url: string;
  method: string;
  requestHeaders: Record<string, string>;
  postData: string | null;
  responseStatus: number;
  responseHeaders: Record<string, string>;
  responseBody: string;
  responseBodyPreview: string;
  capturedAt: string;
}

async function inspect() {
  console.log('🔬 Inspeccionando endpoints sidgad.es...\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();
  const inspected: InspectedRequest[] = [];

  // Interceptar requests a sidgad.es para capturar POST bodies y responses completos
  await context.route(/sidgad\.es/, async (route, request) => {
    const url = request.url();
    const isSidgad = SIDGAD_ENDPOINTS.some((ep) => url.includes(ep));

    // Dejar pasar la request normalmente pero capturarla
    const response = await route.fetch();
    const responseBody = await response.text();

    if (isSidgad) {
      const entry: InspectedRequest = {
        url,
        method: request.method(),
        requestHeaders: request.headers(),
        postData: request.postData(),
        responseStatus: response.status(),
        responseHeaders: response.headers(),
        responseBody,
        responseBodyPreview: responseBody.slice(0, 2000),
        capturedAt: new Date().toISOString(),
      };

      inspected.push(entry);

      console.log(`\n${'─'.repeat(60)}`);
      console.log(`📡 ${request.method()} ${url}`);
      console.log(`   Status: ${response.status()}`);
      console.log(`   Content-Type: ${response.headers()['content-type'] ?? 'no content-type'}`);
      console.log(`   POST body: ${request.postData() ?? '(ninguno)'}`);
      console.log(`   Response size: ${responseBody.length} bytes`);
      console.log(`\n   ── Primeros 1000 chars de la respuesta ──`);
      console.log(`   ${responseBody.slice(0, 1000).replace(/\n/g, '\n   ')}`);
    }

    await route.fulfill({ response, body: responseBody });
  });

  // Fase 1: página principal
  console.log('→ Fase 1: cargando página principal...');
  await page.goto('https://www.hockeypatines.fep.es/', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForTimeout(8000);

  // Fase 2: navegar a competiciones
  console.log('\n→ Fase 2: navegando a competiciones...');
  try {
    const compLink = page.locator('text=Competiciones').first();
    if (await compLink.isVisible({ timeout: 5000 })) {
      await compLink.click();
      await page.waitForTimeout(5000);
    }
  } catch {
    console.log('⚠️  No se encontró Competiciones');
  }

  // Fase 3: intentar navegar directamente a clasificación
  console.log('\n→ Fase 3: buscando clasificación/resultados...');
  try {
    const clasificacionLink = page.locator('text=Clasificación, text=Resultados, text=Jornada').first();
    if (await clasificacionLink.isVisible({ timeout: 3000 })) {
      await clasificacionLink.click();
      await page.waitForTimeout(4000);
    }
  } catch {
    // ignorar
  }

  await browser.close();

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`\n📊 Resumen: ${inspected.length} endpoints sidgad capturados`);

  if (inspected.length === 0) {
    console.log('\n⚠️  No se capturaron endpoints sidgad en esta sesión.');
    console.log('   Posibles causas:');
    console.log('   - La carga dinámica necesita más tiempo (aumentar waitForTimeout)');
    console.log('   - Los endpoints se llaman al hacer click en secciones específicas');
    console.log('   - La URL de los endpoints ha cambiado');
  }

  // Guardar informe completo
  mkdirSync(join(process.cwd(), 'logs'), { recursive: true });
  const reportPath = join(process.cwd(), 'logs', 'sidgad-inspector.json');
  writeFileSync(reportPath, JSON.stringify({ inspectedAt: new Date().toISOString(), endpoints: inspected }, null, 2));
  console.log(`\n✅ Informe completo guardado en: ${reportPath}`);

  // También guardar un resumen legible
  const summaryPath = join(process.cwd(), 'logs', 'sidgad-summary.txt');
  const summary = inspected.map((e) =>
    [
      `URL: ${e.url}`,
      `Method: ${e.method}`,
      `POST body: ${e.postData ?? '(ninguno)'}`,
      `Status: ${e.responseStatus}`,
      `Content-Type: ${e.responseHeaders['content-type'] ?? 'desconocido'}`,
      `Response preview:\n${e.responseBodyPreview}`,
      '─'.repeat(60),
    ].join('\n')
  ).join('\n\n');

  writeFileSync(summaryPath, summary);
  console.log(`✅ Resumen legible guardado en: ${reportPath.replace('json', 'txt')}`);
}

inspect().catch(console.error);

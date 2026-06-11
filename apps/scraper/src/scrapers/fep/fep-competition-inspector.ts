/**
 * INSPECTOR DE COMPETICIÓN INDIVIDUAL
 *
 * Navega dentro de OK LIGA MASCULINA (id=3150, temp=39) y captura
 * todos los endpoints que se llaman al ver calendario, clasificación y acta.
 *
 * Uso: npx ts-node --esm apps/scraper/src/scrapers/fep/fep-competition-inspector.ts
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

interface CapturedCall {
  url: string;
  method: string;
  postData: string | null;
  responseStatus: number;
  contentType: string;
  responseBody: string;
  triggeredBy: string;  // qué acción disparó esta llamada
}

async function inspectCompetition() {
  console.log('🔬 Inspeccionando competición OK LIGA MASCULINA...\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();
  const calls: CapturedCall[] = [];
  let currentAction = 'page_load';

  // Interceptar TODOS los requests a sidgad
  await context.route(/sidgad/, async (route, request) => {
    const response = await route.fetch();
    const body = await response.text();
    const ct = response.headers()['content-type'] ?? '';

    calls.push({
      url: request.url(),
      method: request.method(),
      postData: request.postData(),
      responseStatus: response.status(),
      contentType: ct,
      responseBody: body.slice(0, 5000),  // primeros 5KB de cada respuesta
      triggeredBy: currentAction,
    });

    console.log(`  [${currentAction}] ${request.method()} ${request.url().replace('https://www.server2.sidgad.es/rfep/', '')}`);
    if (request.postData()) console.log(`    POST: ${request.postData()}`);

    await route.fulfill({ response, body });
  });

  // ── PASO 1: Cargar página y esperar ──────────────────────────────
  console.log('→ Paso 1: cargando página principal...');
  currentAction = 'page_load';
  await page.goto('https://www.hockeypatines.fep.es/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);

  // ── PASO 2: Clic en Competiciones ────────────────────────────────
  console.log('\n→ Paso 2: abriendo menú Competiciones...');
  currentAction = 'menu_competiciones';
  try {
    await page.locator('text=Competiciones').first().click();
    await page.waitForTimeout(3000);
  } catch { console.log('  ⚠️  No encontrado'); }

  // ── PASO 3: Buscar y clicar en OK LIGA MASCULINA ─────────────────
  console.log('\n→ Paso 3: entrando en OK LIGA MASCULINA...');
  currentAction = 'click_ok_liga';
  try {
    // Buscar por el id=3150 directamente en el DOM
    const okLiga = page.locator('[id="3150"]').first();
    if (await okLiga.isVisible({ timeout: 5000 })) {
      await okLiga.click();
    } else {
      // Fallback: buscar por texto
      await page.locator('text=OK LIGA MASCULINA').first().click();
    }
    await page.waitForTimeout(5000);
  } catch { console.log('  ⚠️  No encontrado'); }

  // ── PASO 4: Ver clasificación ─────────────────────────────────────
  console.log('\n→ Paso 4: navegando a Clasificación...');
  currentAction = 'click_clasificacion';
  try {
    const clas = page.locator('text=Clasificación, [class*="clasificacion"], [class*="clasif"]').first();
    if (await clas.isVisible({ timeout: 4000 })) {
      await clas.click();
      await page.waitForTimeout(4000);
    } else {
      console.log('  ⚠️  Pestaña Clasificación no visible');
    }
  } catch { console.log('  ⚠️  No encontrado'); }

  // ── PASO 5: Ver calendario/jornadas ──────────────────────────────
  console.log('\n→ Paso 5: navegando a Calendario/Jornadas...');
  currentAction = 'click_calendario';
  try {
    const cal = page.locator('text=Calendario, text=Jornadas, [class*="calendario"]').first();
    if (await cal.isVisible({ timeout: 4000 })) {
      await cal.click();
      await page.waitForTimeout(4000);
    } else {
      console.log('  ⚠️  Pestaña Calendario no visible');
    }
  } catch { console.log('  ⚠️  No encontrado'); }

  // ── PASO 6: Ver un partido concreto ──────────────────────────────
  console.log('\n→ Paso 6: abriendo detalle de un partido...');
  currentAction = 'click_partido';
  try {
    const partido = page.locator('[class*="game_report"], [class*="scorer_game"]').first();
    if (await partido.isVisible({ timeout: 4000 })) {
      await partido.click();
      await page.waitForTimeout(4000);
    } else {
      console.log('  ⚠️  No se encontró link a partido');
    }
  } catch { console.log('  ⚠️  No encontrado'); }

  await browser.close();

  // ── INFORME ───────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(60));
  console.log(`\n📊 Total llamadas capturadas: ${calls.length}`);
  console.log('\nResumen por acción:');
  const byAction: Record<string, string[]> = {};
  for (const c of calls) {
    if (!byAction[c.triggeredBy]) byAction[c.triggeredBy] = [];
    byAction[c.triggeredBy]!.push(`${c.method} ${c.url.replace('https://www.server2.sidgad.es/rfep/', '')} [POST: ${c.postData ?? '-'}]`);
  }
  for (const [action, urls] of Object.entries(byAction)) {
    console.log(`\n  [${action}]:`);
    for (const u of urls) console.log(`    ${u}`);
  }

  mkdirSync(join(process.cwd(), 'logs'), { recursive: true });
  const reportPath = join(process.cwd(), 'logs', 'competition-inspector.json');
  writeFileSync(reportPath, JSON.stringify({ capturedAt: new Date().toISOString(), calls }, null, 2));
  console.log(`\n✅ Informe completo: ${reportPath}`);
}

inspectCompetition().catch(console.error);

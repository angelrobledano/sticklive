/**
 * HERRAMIENTA DE DIAGNÓSTICO
 *
 * Ejecuta este script una vez contra hockeypatines.fep.es para:
 * 1. Capturar TODAS las llamadas de red que hace el sitio
 * 2. Identificar endpoints JSON candidatos a ser APIs
 * 3. Guardar el informe en logs/network-probe.json
 *
 * Uso: npx ts-node src/scrapers/fep/fep-network-probe.ts
 * O:   npm run probe --workspace=apps/scraper
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

interface NetworkEntry {
  url: string;
  method: string;
  resourceType: string;
  status: number;
  contentType: string;
  size: number;
  isJson: boolean;
  jsonPreview?: unknown;
}

async function probe() {
  console.log('🔍 Iniciando sonda de red en hockeypatines.fep.es...\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();
  const entries: NetworkEntry[] = [];

  // Interceptar TODAS las respuestas
  page.on('response', async (response) => {
    const url = response.url();
    // Ignorar tracking, analytics y recursos estáticos obvios
    if (url.includes('google') || url.includes('analytics') || url.includes('facebook')) return;
    if (/\.(png|jpg|gif|ico|woff|woff2|css)$/i.test(url)) return;

    const status = response.status();
    const contentType = response.headers()['content-type'] ?? '';
    const isJson = contentType.includes('application/json') || contentType.includes('text/json');

    let jsonPreview: unknown;
    let size = 0;

    try {
      const body = await response.body();
      size = body.length;
      if (isJson && size < 50_000) {
        jsonPreview = JSON.parse(body.toString('utf-8'));
      }
    } catch {
      // Ignorar
    }

    entries.push({
      url,
      method: response.request().method(),
      resourceType: response.request().resourceType(),
      status,
      contentType,
      size,
      isJson,
      jsonPreview: isJson ? jsonPreview : undefined,
    });
  });

  // SPAs como sidgad.com nunca alcanzan networkidle — usamos domcontentloaded + espera manual
  console.log('→ Cargando página principal...');
  await page.goto('https://www.hockeypatines.fep.es/', { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Esperar a que el JS cargue los datos (ajustar si hace falta más tiempo)
  console.log('→ Esperando carga de datos dinámicos (8s)...');
  await page.waitForTimeout(8000);

  // Intentar hacer click en "Competiciones" si existe
  try {
    const compLink = page.locator('text=Competiciones').first();
    if (await compLink.isVisible({ timeout: 5000 })) {
      console.log('→ Haciendo click en Competiciones...');
      await compLink.click();
      await page.waitForTimeout(4000);
    } else {
      console.log('ℹ️  Link de Competiciones no visible — continuando con lo capturado');
    }
  } catch {
    console.log('⚠️  No se encontró link de Competiciones — continuando');
  }

  await browser.close();

  // Filtrar y ordenar resultados interesantes
  const jsonEndpoints = entries.filter((e) => e.isJson);
  const allEndpoints = entries.filter((e) => e.resourceType === 'xhr' || e.resourceType === 'fetch');

  console.log(`\n📊 Resumen:`);
  console.log(`   Total requests: ${entries.length}`);
  console.log(`   XHR/Fetch: ${allEndpoints.length}`);
  console.log(`   JSON responses: ${jsonEndpoints.length}`);

  if (jsonEndpoints.length > 0) {
    console.log('\n🎯 Endpoints JSON encontrados (¡candidatos a API!):');
    jsonEndpoints.forEach((e) => {
      console.log(`   ${e.method} ${e.url} [${e.status}] ${e.size}b`);
    });
  } else {
    console.log('\n⚠️  No se encontraron endpoints JSON. El sitio puede:');
    console.log('   - Renderizar todo en el servidor (SSR)');
    console.log('   - Usar WebSockets');
    console.log('   - Tener un delay mayor antes de cargar datos');
    console.log('   → Revisar allEndpoints en el informe para más detalles');
  }

  // Guardar informe completo
  mkdirSync(join(process.cwd(), 'logs'), { recursive: true });
  const report = {
    probeDate: new Date().toISOString(),
    url: 'https://www.hockeypatines.fep.es/',
    summary: {
      total: entries.length,
      xhrFetch: allEndpoints.length,
      jsonResponses: jsonEndpoints.length,
    },
    jsonEndpoints,
    allXhrFetch: allEndpoints.map((e) => ({ url: e.url, method: e.method, status: e.status, contentType: e.contentType })),
  };

  const reportPath = join(process.cwd(), 'logs', 'network-probe.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n✅ Informe guardado en: ${reportPath}`);
}

probe().catch(console.error);

/**
 * Gestión del navegador Playwright compartido entre scrapers.
 * Un solo browser, múltiples contextos aislados.
 */
import { chromium, Browser, BrowserContext, Page, Route, Request } from 'playwright';
import { createLogger } from '@sports/logger';

const log = createLogger({ module: 'browser' });

let _browser: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
  if (_browser && _browser.isConnected()) return _browser;

  log.info('Iniciando navegador Playwright');
  _browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
    ],
  });
  return _browser;
}

export async function closeBrowser(): Promise<void> {
  if (_browser) {
    await _browser.close();
    _browser = null;
    log.info('Navegador cerrado');
  }
}

export interface BrowserContextOptions {
  /** Interceptar y capturar llamadas XHR/fetch que coincidan con este patrón */
  captureApiPattern?: RegExp;
  /** Bloquear recursos innecesarios para acelerar scraping */
  blockResources?: boolean;
}

export interface CapturedRequest {
  url: string;
  method: string;
  postData: string | null;
  responseStatus: number;
  responseBody: unknown;
  capturedAt: Date;
}

/**
 * Crea un contexto de navegador aislado listo para scraping.
 * Bloquea imágenes/fuentes/media por defecto para ir más rápido.
 */
export async function createScrapingContext(
  options: BrowserContextOptions = {}
): Promise<{ context: BrowserContext; capturedRequests: CapturedRequest[] }> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent:
      process.env['SCRAPER_USER_AGENT'] ??
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
    extraHTTPHeaders: {
      'Accept-Language': 'es-ES,es;q=0.9',
    },
  });

  const capturedRequests: CapturedRequest[] = [];

  // Bloquear recursos que no aportan datos
  if (options.blockResources !== false) {
    await context.route(
      (url) => {
        const resourceTypes = ['image', 'media', 'font', 'stylesheet'];
        return resourceTypes.some((t) => url.toString().includes(t));
      },
      (route: Route) => route.abort()
    );
  }

  // Interceptar llamadas API si se especifica patrón
  if (options.captureApiPattern) {
    const pattern = options.captureApiPattern;
    await context.route(pattern, async (route: Route, request: Request) => {
      const response = await route.fetch();
      let responseBody: unknown = null;

      try {
        const contentType = response.headers()['content-type'] ?? '';
        if (contentType.includes('application/json')) {
          responseBody = await response.json();
        } else {
          responseBody = await response.text();
        }
      } catch {
        // Ignorar errores de parseo
      }

      capturedRequests.push({
        url: request.url(),
        method: request.method(),
        postData: request.postData(),
        responseStatus: response.status(),
        responseBody,
        capturedAt: new Date(),
      });

      await route.fulfill({ response });
    });
  }

  return { context, capturedRequests };
}

/**
 * Navega a una URL y espera a que la red esté quieta.
 * Reintentos automáticos ante errores de red.
 */
export async function navigateTo(
  page: Page,
  url: string,
  options: { retries?: number; waitUntil?: 'networkidle' | 'domcontentloaded' | 'load' } = {}
): Promise<void> {
  const { retries = 3, waitUntil = 'networkidle' } = options;
  const timeout = Number(process.env['SCRAPER_REQUEST_TIMEOUT_MS'] ?? 30_000);

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await page.goto(url, { waitUntil, timeout });
      return;
    } catch (err) {
      log.warn({ url, attempt, err }, `Error al navegar (intento ${attempt}/${retries})`);
      if (attempt === retries) throw err;
      await sleep(Number(process.env['SCRAPER_RETRY_DELAY_MS'] ?? 2_000) * attempt);
    }
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

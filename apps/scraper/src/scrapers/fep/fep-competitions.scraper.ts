/**
 * Scraper de competiciones de hockeypatines.fep.es
 *
 * ESTRATEGIA:
 * 1. Intentar capturar llamadas XHR/fetch al backend de sidgad.com
 *    (es la fuente más fiable si existen endpoints JSON).
 * 2. Si no hay API JSON, hacer fallback a parsing HTML con Cheerio.
 *
 * NOTA: El sitio usa sidgad.com como plataforma deportiva. Los endpoints
 * reales se descubren interceptando la red en el primer run. Ajustar
 * FEP_API_PATTERN cuando se identifiquen.
 */
import { Page } from 'playwright';
import * as cheerio from 'cheerio';
import { BaseScraper } from '../../core/base-scraper.js';
import { requireFepSourceId } from '../../core/fep-source.js';
import { createScrapingContext, navigateTo } from '../../core/browser.js';
import type { ScrapedCompetition, ScrapedTrace } from '@sports/shared-types';

// Patrón para capturar llamadas a la API interna de sidgad.
// Actualizar cuando se identifiquen los endpoints reales.
const SIDGAD_API_PATTERN = /sidgad\.com.*\/(api|service|data)\//i;

const BASE_URL = 'https://www.hockeypatines.fep.es';
// ID de la fuente — UUID en data_sources (scraper_key=fep_hockey). Obligatorio.
const SOURCE_ID = requireFepSourceId();

export class FepCompetitionsScraper extends BaseScraper<ScrapedCompetition> {
  constructor() {
    super({
      scraperKey: 'fep_hockey',
      entityType: 'competition',
      sourceId: SOURCE_ID,
    });
  }

  protected async scrape(): Promise<ScrapedCompetition[]> {
    const { context, capturedRequests } = await createScrapingContext({
      captureApiPattern: SIDGAD_API_PATTERN,
      blockResources: true,
    });

    const page = await context.newPage();

    try {
      await navigateTo(page, `${BASE_URL}/`, { waitUntil: 'networkidle' });

      // Log de APIs capturadas — útil para descubrir endpoints
      if (capturedRequests.length > 0) {
        this.log.info(
          { apiCalls: capturedRequests.map((r) => ({ url: r.url, status: r.responseStatus })) },
          '🔍 APIs capturadas en primer load — revisa estos endpoints'
        );

        // Intentar extraer competiciones de las respuestas JSON capturadas
        const fromApi = this.extractFromApiResponses(capturedRequests);
        if (fromApi.length > 0) {
          this.log.info({ count: fromApi.length }, 'Competiciones extraídas via API');
          return fromApi;
        }
      }

      // Fallback: parsing HTML
      this.log.info('No se encontró API JSON — usando parsing HTML');
      return await this.parseFromHtml(page);
    } finally {
      await page.close();
      await context.close();
    }
  }

  /**
   * Intenta extraer competiciones de respuestas JSON capturadas.
   * IMPORTANTE: ajustar la lógica según la estructura real de sidgad.com
   * una vez se identifiquen los endpoints.
   */
  private extractFromApiResponses(
    captured: Array<{ url: string; responseBody: unknown; capturedAt: Date }>
  ): ScrapedCompetition[] {
    const competitions: ScrapedCompetition[] = [];

    for (const req of captured) {
      const body = req.responseBody;
      if (!body || typeof body !== 'object') continue;

      // Intento genérico: buscar arrays que parezcan competiciones
      const arrays = this.findArraysInObject(body as Record<string, unknown>);
      for (const arr of arrays) {
        if (this.looksLikeCompetitionList(arr)) {
          this.log.info({ url: req.url }, '✅ Encontrada posible lista de competiciones via API');
          for (const item of arr) {
            const comp = this.normalizeApiCompetition(item, req.url, req.capturedAt);
            if (comp) competitions.push(comp);
          }
        }
      }
    }

    return competitions;
  }

  /**
   * Parsing HTML de la página principal.
   * Extrae los links de competiciones del menú/lista.
   */
  private async parseFromHtml(page: Page): Promise<ScrapedCompetition[]> {
    const html = await page.content();
    const $ = cheerio.load(html);
    const competitions: ScrapedCompetition[] = [];
    const trace: ScrapedTrace = {
      sourceId: SOURCE_ID,
      sourceUrl: `${BASE_URL}/`,
      scrapedAt: new Date(),
    };

    // Selector genérico — AJUSTAR cuando se inspeccione el HTML real
    // La web carga dinámicamente así que puede ser que el HTML esté vacío aquí
    $('a[href*="/competicion"], a[href*="/competition"], .competition-item').each((_, el) => {
      const $el = $(el);
      const rawName = $el.text().trim();
      const href = $el.attr('href') ?? '';
      if (!rawName) return;

      const slug = this.slugify(rawName);
      competitions.push({
        rawName,
        name: rawName,
        slug,
        country: 'ES',
        sourceRef: href,
        sourceUrl: href.startsWith('http') ? href : `${BASE_URL}${href}`,
        ...trace,
      });
    });

    // Si no se encontró nada, loguear el HTML para debugging
    if (competitions.length === 0) {
      this.log.warn(
        {
          htmlLength: html.length,
          htmlPreview: html.slice(0, 500),
        },
        'No se encontraron competiciones en HTML — la página puede necesitar más tiempo de carga o hay un selector incorrecto'
      );
    }

    return competitions;
  }

  // ── Helpers ──────────────────────────────────────────────────

  private findArraysInObject(obj: Record<string, unknown>): unknown[][] {
    const arrays: unknown[][] = [];
    for (const value of Object.values(obj)) {
      if (Array.isArray(value) && value.length > 0) {
        arrays.push(value);
      } else if (value && typeof value === 'object') {
        arrays.push(...this.findArraysInObject(value as Record<string, unknown>));
      }
    }
    return arrays;
  }

  private looksLikeCompetitionList(arr: unknown[]): boolean {
    if (arr.length === 0) return false;
    const first = arr[0];
    if (!first || typeof first !== 'object') return false;
    const keys = Object.keys(first as object).map((k) => k.toLowerCase());
    return keys.some((k) => ['nombre', 'name', 'competicion', 'competition', 'titulo'].includes(k));
  }

  private normalizeApiCompetition(
    item: unknown,
    sourceUrl: string,
    scrapedAt: Date
  ): ScrapedCompetition | null {
    if (!item || typeof item !== 'object') return null;
    const obj = item as Record<string, unknown>;

    const rawName = String(
      obj['nombre'] ?? obj['name'] ?? obj['titulo'] ?? obj['competition'] ?? ''
    );
    if (!rawName) return null;

    return {
      rawName,
      name: rawName,
      slug: this.slugify(rawName),
      country: 'ES',
      sourceId: SOURCE_ID,
      sourceRef: String(obj['id'] ?? obj['cod'] ?? obj['codigo'] ?? ''),
      sourceUrl,
      scrapedAt,
    };
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }
}

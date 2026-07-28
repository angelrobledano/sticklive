/**
 * Scraper de clasificacion -- rfep_clasif_idc_{IDC}_1.php
 */
import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { BaseScraper } from '../../core/base-scraper.js';
import { requireFepSourceId } from '../../core/fep-source.js';
import { sidgadPost, SIDGAD_LANG } from './sidgad-client.js';
import type { ScrapedStanding } from '@sports/shared-types';

const BASE_URL = 'https://www.server2.sidgad.es/rfep';
// Los logos de clubes estan en sidgad.cloud (descubierto via fep-competition-inspector.ts)
const LOGO_CDN_BASE = 'https://sidgad.cloud/rfep/images/logos_clubes';
const SOURCE_ID = requireFepSourceId();

export interface StandingsScraperConfig {
  idc: string;
  competitionName?: string;
}

export class FepStandingsScraper extends BaseScraper<ScrapedStanding> {
  private standingsConfig: StandingsScraperConfig;

  constructor(config: StandingsScraperConfig) {
    super({
      scraperKey: 'fep_hockey',
      entityType: 'standing',
      sourceId: SOURCE_ID,
    });
    this.standingsConfig = config;
  }

  protected async scrape(): Promise<ScrapedStanding[]> {
    const { idc, competitionName } = this.standingsConfig;
    const endpointPath = `rfep_clasif_idc_${idc}_1.php`;
    this.log.info({ idc, competition: competitionName ?? idc }, 'Scrapeando clasificacion');
    const html = await sidgadPost(endpointPath, { idc, site_lang: SIDGAD_LANG });
    return this.parseStandings(html, idc);
  }

  private parseStandings(html: string, idc: string): ScrapedStanding[] {
    const $ = cheerio.load(html);
    const standings: ScrapedStanding[] = [];
    const scrapedAt = new Date();
    const sourceUrl = `${BASE_URL}/rfep_clasif_idc_${idc}_1.php`;
    let currentGroupName: string | undefined;

    $('body').children().each((_, node) => {
      const $node = $(node);

      if ($node.hasClass('div_titulo_fase_idc') || $node.is('.div_titulo_fase_idc')) {
        const rawText = $node.find('.lang_label.lang_es').first().text().trim()
          || $node.text().trim();
        // Sólo es un GRUPO real si el título no es el genérico de la tabla. El
        // filtro anterior comparaba sin normalizar tildes ('CLASIFICACIÓN' !==
        // 'CLASIFICACION'), así que el título genérico se colaba como grupo y la
        // web pintaba "Grupo CLASIFICACIÓN" perdiendo las zonas de playoff.
        if (rawText && !isGenericStandingsTitle(rawText)) {
          currentGroupName = rawText;
        }
      }

      if ($node.is('table.tabla_clasif') || $node.find('table.tabla_clasif').length > 0) {
        const $table = $node.is('table.tabla_clasif')
          ? $node
          : $node.find('table.tabla_clasif').first();

        $table.find('tbody tr').each((_, row) => {
          const $row = $(row);
          const cells = $row.find('td');
          if (cells.length < 10) return;
          try {
            const standing = this.parseStandingRow($, $row, cells, { groupName: currentGroupName, sourceUrl, scrapedAt });
            if (standing) standings.push(standing);
          } catch (err) {
            this.captureError(this.parseErrors, err, { entityRef: `row_${cells.eq(2).text().trim() || 'unknown'}` });
          }
        });
      }
    });

    if (standings.length === 0) {
      $('table.tabla_clasif').each((tableIdx, table) => {
        $(table).find('tbody tr').each((_, row) => {
          const $row = $(row);
          const cells = $row.find('td');
          if (cells.length < 10) return;
          try {
            const standing = this.parseStandingRow($, $row, cells, { groupName: undefined, sourceUrl, scrapedAt });
            if (standing) standings.push(standing);
          } catch (err) {
            this.captureError(this.parseErrors, err, { entityRef: `table${tableIdx}_row_${cells.eq(2).text().trim() || 'unknown'}` });
          }
        });
      });
    }

    this.log.info(
      { idc, total: standings.length, groups: [...new Set(standings.map(s => s.groupName))] },
      'Clasificacion extraida'
    );
    return standings;
  }

  private parseStandingRow(
    $: cheerio.CheerioAPI,
    $row: cheerio.Cheerio<Element>,
    cells: cheerio.Cheerio<Element>,
    ctx: { groupName?: string; sourceUrl: string; scrapedAt: Date }
  ): ScrapedStanding | null {
    const positionText = cells.eq(0).text().trim();
    const position = positionText ? parseInt(positionText, 10) : undefined;
    if (!position || isNaN(position)) return null;

    const logoSrc = cells.eq(1).find('img').attr('src') ?? '';
    const logoFile = logoSrc.split('/').pop() ?? '';
    const logoUrl = resolveLogoUrl(logoSrc);

    const teamName = cells.eq(2).find('.no_mobile').first().text().trim()
      || cells.eq(2).text().trim();
    const abbreviation = cells.eq(2).find('.mobile').first().text().trim();
    if (!teamName) return null;

    const points       = parseStatInt(cells.eq(3).text());
    const played       = parseStatInt(cells.eq(4).text());
    const won          = parseStatInt(cells.eq(5).text());
    const drawn        = parseStatInt(cells.eq(6).text());
    const lost         = parseStatInt(cells.eq(7).text());
    const goalsFor     = parseStatInt(cells.eq(8).text());
    const goalsAgainst = parseStatInt(cells.eq(9).text());
    const teamRef      = teamName;

    if (this.log.isLevelEnabled('debug')) {
      this.log.debug(
        { position, teamName, abbreviation, points, played, won, drawn, lost, goalsFor, goalsAgainst, logoFile, logoUrl },
        'Standing parseado'
      );
    }

    return {
      teamRef,
      groupName: ctx.groupName,
      position,
      played,
      won,
      drawn,
      lost,
      goalsFor,
      goalsAgainst,
      points,
      logoUrl: logoUrl ?? undefined,
      sourceId: SOURCE_ID,
      sourceRef: abbreviation ? `fep_team_abbr_${abbreviation}` : undefined,
      sourceUrl: ctx.sourceUrl,
      scrapedAt: ctx.scrapedAt,
    } as ScrapedStanding;
  }

  private get parseErrors(): Array<{ message: string; entityRef?: string }> {
    return [];
  }
}

// ── Helpers ──────────────────────────────────

/** Quita diacríticos y normaliza a MAYÚSCULAS para comparar títulos. */
function normalizeTitle(raw: string): string {
  return raw.normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase().trim();
}

// Títulos genéricos de la cabecera de la tabla que NO son un grupo real: las
// ligas son de tabla única. Incluye variantes con/sin tilde (es), catalán y en.
const GENERIC_STANDINGS_TITLES = new Set([
  'CLASIFICACION', 'CLASSIFICACIO', 'CLASSIFICACION', 'STANDINGS', 'CLASSIFICATION',
]);

/** True si el título es el genérico de la tabla (no un grupo distintivo). */
export function isGenericStandingsTitle(raw: string): boolean {
  return GENERIC_STANDINGS_TITLES.has(normalizeTitle(raw));
}

function parseStatInt(text: string): number {
  const clean = text.trim();
  if (!clean) return 0;
  const n = parseInt(clean, 10);
  return isNaN(n) ? 0 : n;
}

function resolveLogoUrl(src: string): string | null {
  if (!src) return null;
  try {
    // Si el src es una ruta relativa como "../../images/logos_clubes/shum.png"
    // resolvemos contra BASE_URL para obtener el filename, luego redirigimos a sidgad.cloud
    const resolved = new URL(src, `${BASE_URL}/`).href;
    const filename = resolved.split('/').pop();
    if (filename) return `${LOGO_CDN_BASE}/${filename}`;
    return resolved;
  } catch {
    return null;
  }
}

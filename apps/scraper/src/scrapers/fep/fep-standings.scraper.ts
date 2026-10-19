/**
 * Scraper de clasificacion -- rfep_clasif_idc_{IDC}_1.php
 */
import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { FepBaseScraper } from './fep-base-scraper.js';
import { requireFepSourceId } from '../../core/fep-source.js';
import { sidgadPost, SIDGAD_LANG } from './sidgad-client.js';
import { isByeTeamName } from './bye-team.js';
import { isGenericStandingsTitle, parseGroupTitle } from './standings-title.js';
import type { ScrapedStanding } from '@sports/shared-types';

const BASE_URL = 'https://www.server2.sidgad.es/rfep';
// Los logos de clubes estan en sidgad.cloud (descubierto via fep-competition-inspector.ts)
const LOGO_CDN_BASE = 'https://sidgad.cloud/rfep/images/logos_clubes';
const SOURCE_ID = requireFepSourceId();

export interface StandingsScraperConfig {
  idc: string;
  competitionName?: string;
}

export class FepStandingsScraper extends FepBaseScraper<ScrapedStanding> {
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

  /**
   * Parser del HTML de clasificación, común a todos los portales sidgad.
   *
   * Público para poder fijarlo con HTML real en tests sin hacer red.
   *
   * - FEP publica `tabla_standard tabla_clasif`; FECAPA solo `tabla_standard`.
   * - FECAPA mete varios grupos en la MISMA respuesta y el grupo está en la
   *   cabecera de cada tabla («GRUPO GRUP A»), no en el título de fase. Cuando
   *   hay cabeceras de grupo se ignoran las tablas sin grupo (la clasificación
   *   de la fase final, que no es una liguilla).
   */
  parseStandings(html: string, idc: string): ScrapedStanding[] {
    const $ = cheerio.load(html);
    const standings: ScrapedStanding[] = [];
    const scrapedAt = new Date();
    const sourceUrl = `${BASE_URL}/rfep_clasif_idc_${idc}_1.php`;

    // Recorre títulos y tablas en orden de documento (selector unión: cada nodo
    // aparece una sola vez aunque la tabla tenga ambas clases).
    const tables: Array<{ table: Element; groupName?: string; phaseTitle?: string }> = [];
    let currentPhaseTitle: string | undefined;
    $('div.div_titulo_fase_idc, table.tabla_clasif, table.tabla_standard').each((_, node) => {
      const $node = $(node);
      if ($node.is('div.div_titulo_fase_idc')) {
        const rawText = $node.find('.lang_label.lang_es').first().text().trim()
          || $node.text().trim();
        currentPhaseTitle = rawText || undefined;
        return;
      }
      tables.push({
        table: node as Element,
        groupName: parseGroupTitle(tableHeaderText($, node)),
        phaseTitle: currentPhaseTitle,
      });
    });

    // Si alguna tabla declara grupo en su cabecera, es una competición con
    // grupos: solo esas tablas son clasificación de grupo.
    const hasHeaderGroups = tables.some((t) => !!t.groupName);

    for (const entry of tables) {
      let groupName = entry.groupName;
      if (!groupName && !hasHeaderGroups) {
        // Fuentes de una sola tabla: el grupo (si existe) viene del título de
        // fase, nunca del genérico "CLASIFICACIÓN".
        if (entry.phaseTitle && !isGenericStandingsTitle(entry.phaseTitle)) {
          groupName = entry.phaseTitle;
        }
      }
      if (hasHeaderGroups && !groupName) continue;

      $(entry.table).find('tbody tr').each((_, row) => {
        const $row = $(row);
        const cells = $row.find('td');
        if (cells.length < 10) return;
        try {
          const standing = this.parseStandingRow($, $row, cells, { groupName, sourceUrl, scrapedAt });
          if (standing) standings.push(standing);
        } catch (err) {
          this.captureError(this.parseErrors, err, { entityRef: `row_${cells.eq(2).text().trim() || 'unknown'}` });
        }
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
    // La tabla de Bronce (nº impar de equipos) incluye una fila de bye
    // ("DESCANSO") que no es un equipo: sin filtrarla, la resolución falla y
    // tumba la transacción del grupo entero (clasificación a 0).
    if (isByeTeamName(teamName)) return null;

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
      abbreviation: abbreviation || undefined,
      logoUrl: logoUrl ?? undefined,
      sourceId: SOURCE_ID,
      sourceRef: abbreviation ? `fep_team_abbr_${abbreviation}` : undefined,
      sourceUrl: ctx.sourceUrl,
      scrapedAt: ctx.scrapedAt,
    } as ScrapedStanding;
  }
}

// ── Helpers ──────────────────────────────────

function parseStatInt(text: string): number {
  const clean = text.trim();
  if (!clean) return 0;
  const n = parseInt(clean, 10);
  return isNaN(n) ? 0 : n;
}

/** Texto de la primera cabecera de la tabla en el idioma activo (es). */
function tableHeaderText($: cheerio.CheerioAPI, table: Element): string {
  const $th = $(table).find('thead th').first();
  if (!$th.length) return '';
  const $clone = $th.clone();
  if ($clone.find('.lang_label').length > 0) $clone.find('.lang_label').not('.lang_es').remove();
  return $clone.text().replace(/\s+/g, ' ').trim();
}

function resolveLogoUrl(src: string): string | null {
  if (!src) return null;
  // Colapsa barras duplicadas sin romper el esquema (https://).
  const normalized = src.replace(/([^:])\/{2,}/g, '$1/');
  // FECAPA (y otros portales) ya entrega la URL absoluta de SU CDN; hay que
  // conservarla tal cual. Antes se reescribía a la base rfep y el escudo
  // apuntaba a un fichero inexistente.
  if (/^https?:\/\//i.test(normalized)) return normalized;
  try {
    // Si el src es una ruta relativa como "../../images/logos_clubes/shum.png"
    // resolvemos contra BASE_URL para obtener el filename, luego redirigimos a sidgad.cloud
    const resolved = new URL(normalized, `${BASE_URL}/`).href;
    const filename = resolved.split('/').pop();
    if (filename) return `${LOGO_CDN_BASE}/${filename}`;
    return resolved;
  } catch {
    return null;
  }
}

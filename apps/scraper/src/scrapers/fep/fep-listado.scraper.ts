/**
 * Scraper de competiciones — rfep_ls_1.php
 *
 * Extrae las 390 competiciones del listado sidgad con sus metadatos:
 * ID, nombre, temporada, equipos participantes y config.
 *
 * Estrategia: GET directo con fetch (no necesita Playwright).
 */
import * as cheerio from 'cheerio';
import { BaseScraper } from '../../core/base-scraper.js';
import { requireFepSourceId } from '../../core/fep-source.js';
import { sidgadGet, CURRENT_TEMP } from './sidgad-client.js';
import type { ScrapedTrace } from '@sports/shared-types';

const SOURCE_URL = 'https://www.server2.sidgad.es/rfep/rfep_ls_1.php';
const SOURCE_ID = requireFepSourceId();

/** Datos de una competición extraídos del listado */
export interface RawCompetition {
  idc: string;               // ID numérico de sidgad (ej: "3150")
  name: string;              // "OK LIGA MASCULINA"
  logoFile: string;          // "ok_liga.png"
  tempId: string;            // "39" (temporada actual)
  clubIds: string[];         // ["72","45","68",...] (IDs de clubs participantes)
  configParams: string;      // string raw de config (ids_teams, tpo_reg, etc.)
  teamIds: string[];         // extraídos de config_params.ids_teams
  acceso: string;            // "calendario_btn"
  // Trazabilidad
  sourceId: string;
  sourceUrl?: string;
  scrapedAt: Date;
}

export class FepListadoScraper extends BaseScraper<RawCompetition> {
  /** Filtrar solo las competiciones de una temporada concreta */
  private tempFilter: string;

  constructor(tempFilter = CURRENT_TEMP) {
    super({
      scraperKey: 'fep_hockey',
      entityType: 'competition_listado',
      sourceId: SOURCE_ID,
    });
    this.tempFilter = tempFilter;
  }

  protected async scrape(): Promise<RawCompetition[]> {
    this.log.info({ tempFilter: this.tempFilter }, 'Obteniendo listado de competiciones');

    const html = await sidgadGet('rfep_ls_1.php');
    const $ = cheerio.load(html);
    const results: RawCompetition[] = [];
    const trace: Pick<ScrapedTrace, 'sourceId' | 'sourceUrl' | 'scrapedAt'> = {
      sourceId: SOURCE_ID,
      sourceUrl: SOURCE_URL,
      scrapedAt: new Date(),
    };

    $('a.listado_competiciones_fila').each((_, el) => {
      const $el = $(el);

      const idc = $el.attr('id') ?? '';
      const name = ($el.attr('name') ?? '').trim();
      const logoFile = $el.attr('logo') ?? '';
      const configParams = $el.attr('config_params') ?? '';
      const acceso = $el.attr('acceso') ?? '';

      if (!idc || !name) return;

      // Extraer temp_X y club_X de las clases CSS
      const classes = ($el.attr('class') ?? '').split(/\s+/);
      const tempClass = classes.find((c) => c.startsWith('temp_'));
      const tempId = tempClass ? tempClass.replace('temp_', '') : '';
      const clubIds = classes
        .filter((c) => c.startsWith('club_'))
        .map((c) => c.replace('club_', ''));

      // Filtrar por temporada si se especifica
      if (this.tempFilter && tempId !== this.tempFilter) return;

      // Extraer team IDs de config_params (ids_teams:3361,3358,...)
      const teamIdsMatch = configParams.match(/ids_teams:([^;]+)/);
      const teamIds = teamIdsMatch
        ? teamIdsMatch[1]!.split(',').filter(Boolean)
        : [];

      results.push({
        idc,
        name,
        logoFile,
        tempId,
        clubIds,
        configParams,
        teamIds,
        acceso,
        ...trace,
      });
    });

    this.log.info(
      { total: results.length, temp: this.tempFilter },
      'Competiciones extraídas del listado'
    );

    return results;
  }
}

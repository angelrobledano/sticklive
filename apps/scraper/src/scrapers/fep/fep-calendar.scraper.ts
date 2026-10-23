/**
 * Scraper de calendario y resultados — cal_idc_{IDC}_1.php
 *
 * Para cada competición, hace POST y parsea la tabla de partidos:
 * jornada, fecha, hora, equipos (por class team_X y nombre visible),
 * resultado final, ID de partido (idp).
 *
 * La tabla tiene esta estructura por fila:
 *   <tr class="team_3408 team_3358 team_class" gamedate="20250926">
 *     <td>fecha</td><td>hora</td>
 *     <td><img logo local></td><td>nombre equipo local</td>
 *     <td><img logo visitante></td><td>nombre equipo visitante</td>
 *     <td class="web_link_td">1 - 4</td>
 *     <td><i class="game_report" idp="32743" idc="3150"></i></td>
 *   </tr>
 */
import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { FepBaseScraper } from './fep-base-scraper.js';
import { requireFepSourceId } from '../../core/fep-source.js';
import { sidgadPost, SidgadClient, SIDGAD_LANG } from './sidgad-client.js';
import { isByeTeamName } from './bye-team.js';
import type { ScrapedMatch, MatchStatus, StructureRow } from '@sports/shared-types';
import { zonedToUtc } from '../../core/eu-timezone.js';
import { collectCalendarRows } from '../../core/sidgad-structure.js';
import { currentSource, matchRef, type SourceDef } from '../../core/sources.js';

// La estructura del calendario (fases y cabeceras de ronda) es común a todos
// los portales sidgad (FEP, World Skate, FECAPA…): vive en core/.
export { collectRoundRows, collectCalendarRows, type CalendarRow } from '../../core/sidgad-structure.js';

/** Zona por defecto si la competición no trae una (competitions.timezone). */
const DEFAULT_TIMEZONE = 'Europe/Madrid';

const BASE_URL = 'https://www.server2.sidgad.es/rfep';
const SOURCE_ID = requireFepSourceId();

/**
 * URLs de los escudos (local, visitante) de una fila del calendario. La fuente
 * pone un `<img class="team_logo">` por equipo con el logo del CDN; sin capturarlo
 * `teams.logo_url` queda NULL y la web cae al escudo genérico. El CDN aparece a
 * veces con doble barra (`images//logos_clubes/…`): se normaliza a una sola.
 * Función pura para poder testearla.
 */
export function extractTeamLogoUrls(
  $: cheerio.CheerioAPI,
  row: Element,
): [string | null, string | null] {
  const srcs = $(row)
    .find('img')
    .map((_, img) => $(img).attr('src') ?? '')
    .get()
    .filter((s) => /logos_clubes\//.test(s))
    .map((s) => s.replace(/\/{2,}logos_clubes\//, '/logos_clubes/'));
  return [srcs[0] ?? null, srcs[1] ?? null];
}

/**
 * Estado que se deduce del CALENDARIO: solo `finished` cuando hay resultado
 * publicado. Sin resultado el calendario NO sabe si el partido está en juego,
 * aplazado o por empezar, así que no emite señal (`undefined`) y el loader
 * conserva el estado que haya puesto el feed en vivo. La hora prevista no se
 * usa jamás para declarar un partido `live`.
 */
export function statusFromCalendarScore(scoreText: string): MatchStatus | undefined {
  return /\d+\s*[-:]\s*\d+/.test(scoreText) ? 'finished' : undefined;
}

export interface CalendarScraperConfig {
  /** ID de competición sidgad (ej: "3150" para OK LIGA) */
  idc: string;
  /** ID de temporada en DB (UUID) — para asociar los partidos */
  seasonId: string;
  /** Nombre de la competición (para logging) */
  competitionName?: string;
  /**
   * Zona IANA en la que la fuente publica las horas (competitions.timezone).
   * Sin indicar = Europe/Madrid (comportamiento histórico).
   */
  timezone?: string;
  /**
   * Portal de origen (A1). Por defecto el de SIDGAD_PORTAL: las refs de
   * partido y fase llevan su clave para no chocar con las de RFEP.
   */
  source?: SourceDef;
}

export class FepCalendarScraper extends FepBaseScraper<ScrapedMatch> {
  private calendarConfig: CalendarScraperConfig;
  /**
   * Filas del último scrape con su estructura (incluidas las que no son partido
   * todavía) y el partido que generó cada una, si alguno. El ETL planifica las
   * fases con ellas (`planSourceStructure`).
   */
  public calendarRows: Array<{ structure: StructureRow; match: ScrapedMatch | null }> = [];

  constructor(config: CalendarScraperConfig) {
    super({
      scraperKey: 'fep_hockey',
      entityType: 'match',
      sourceId: SOURCE_ID,
    });
    this.calendarConfig = config;
    this.source = config.source ?? currentSource();
  }

  private readonly source: SourceDef;

  protected async scrape(): Promise<ScrapedMatch[]> {
    const { idc, seasonId, competitionName } = this.calendarConfig;
    const endpointPath = `rfep_cal_idc_${idc}_1.php`;

    this.log.info(
      { idc, competition: competitionName ?? idc },
      'Scrapeando calendario'
    );

    // Con una fuente explícita, la petición va a SU portal (FECAPA, autonómicas).
    // Sin ella, el cliente por defecto del entorno (compatibilidad).
    const params = { idc, site_lang: SIDGAD_LANG };
    const html = this.calendarConfig.source
      ? await new SidgadClient(this.calendarConfig.source.client).post(endpointPath, params)
      : await sidgadPost(endpointPath, params);

    return this.parseCalendar(html, idc, seasonId);
  }

  private parseCalendar(
    html: string,
    idc: string,
    seasonId: string
  ): ScrapedMatch[] {
    const $ = cheerio.load(html);
    const matches: ScrapedMatch[] = [];
    const scrapedAt = new Date();

    // Recorrer el calendario asociando cada fila con su FASE explícita (bloque
    // content_fase_X + título) y su cabecera de ronda (ver collectCalendarRows).
    this.calendarRows = [];
    for (const { structure, row } of collectCalendarRows($, this.source.key)) {
      let match: ScrapedMatch | null = null;
      try {
        match = this.parseMatchRow($, $(row), {
          idc,
          seasonId,
          roundName: structure.roundLabel ?? '',
          scrapedAt,
        });
        if (match) {
          match.phaseRef = structure.phaseRef;
          match.phaseName = structure.phaseTitle;
          matches.push(match);
        }
      } catch (err) {
        this.captureError(this.parseErrors, err, {
          entityRef: $(row).attr('class') ?? 'unknown',
        });
      }
      this.calendarRows.push({ structure, match });
    }

    this.log.info({ idc, total: matches.length }, 'Partidos extraídos del calendario');
    return matches;
  }

  private parseMatchRow(
    $: cheerio.CheerioAPI,
    $row: cheerio.Cheerio<Element>,
    ctx: { idc: string; seasonId: string; roundName: string; scrapedAt: Date }
  ): ScrapedMatch | null {
    // Extraer IDs de equipo desde las clases CSS: team_3408 team_3358. Un cruce
    // aún sin decidir trae `team_ team_` (sin id): no es un partido todavía.
    const classes = ($row.attr('class') ?? '').split(/\s+/);
    const teamClasses = classes.filter((c) => /^team_\d+$/.test(c));
    if (teamClasses.length < 2) return null;

    const homeTeamRef = teamClasses[0]!.replace('team_', '');
    const awayTeamRef = teamClasses[1]!.replace('team_', '');

    // Fecha del partido desde atributo gamedate="20250926"
    const gamedateStr = $row.attr('gamedate') ?? '';
    const dateparts = parseGamedate(gamedateStr);

    // Hora desde la 3ª celda (índice 2)
    const cells = $row.find('td');
    const timeStr = cells.eq(2).text().trim(); // "21:00"
    const scheduledAt = dateparts
      ? combineDateAndTime(dateparts, timeStr, this.calendarConfig.timezone ?? DEFAULT_TIMEZONE)
      : undefined;

    // Nombres de equipo (para logging/debug, no los usamos como ref)
    const homeTeamName = $row.find('.nombre_junto_logo').eq(0).text().trim();
    const awayTeamName = $row.find('.nombre_junto_logo').eq(1).text().trim();

    // Escudos del CDN (local, visitante) → rellenan `teams.logo_url` si falta.
    const [homeTeamLogoUrl, awayTeamLogoUrl] = extractTeamLogoUrls($, $row.get(0)!);

    // La fila de descanso (bye) trae a "DESCANSO" como rival, con su propia ref
    // (verificado en Bronce N/S 2026/27). No es un partido: se omite aquí para
    // no emitirlo y acabar con un descarte ruidoso + cola HITL ensuciada.
    if (isByeTeamName(homeTeamName) || isByeTeamName(awayTeamName)) return null;

    // Resultado: celda con clase web_link_td que contiene "1 - 4" o vacío
    const scoreText = $row.find('.web_link_td').first().text().trim();
    const { homeScore, awayScore } = parseScore(scoreText);

    // Estado: el calendario solo sabe si hay resultado (ver statusFromCalendarScore).
    const status = statusFromCalendarScore(scoreText);

    // ID del partido (idp) desde el botón de ficha
    const $gameReport = $row.find('i.game_report, a.link_ficha_partido, [idp]');
    const idp = $gameReport.attr('idp') ?? $gameReport.attr('id')?.replace('fichapartido_', '');

    const sourceRef = idp ? matchRef(this.source, idp) : undefined;
    const sourceUrl = idp
      ? `${BASE_URL}/acta_1_${idp}.php`
      : undefined;

    if (this.log.isLevelEnabled('debug')) {
      this.log.debug(
        {
          round: ctx.roundName,
          home: homeTeamName,
          away: awayTeamName,
          score: scoreText,
          idp,
        },
        'Partido parseado'
      );
    }

    return {
      seasonId: ctx.seasonId,
      roundRef: ctx.roundName || undefined, // nombre de ronda de la fuente (Final, Cuartos…)
      homeTeamRef,
      awayTeamRef,
      homeTeamLogoUrl,
      awayTeamLogoUrl,
      homeScore,
      awayScore,
      status,
      scheduledAt: scheduledAt?.toISOString(),
      sourceId: SOURCE_ID,
      sourceRef,
      sourceUrl,
      scrapedAt: ctx.scrapedAt,
    } as ScrapedMatch;
  }
}

// ── Helpers de parsing ──────────────────────────────────

function parseGamedate(gamedateStr: string): { year: number; month: number; day: number } | null {
  if (!gamedateStr || gamedateStr.length !== 8) return null;
  const year  = parseInt(gamedateStr.slice(0, 4), 10);
  const month = parseInt(gamedateStr.slice(4, 6), 10) - 1; // 0-based
  const day   = parseInt(gamedateStr.slice(6, 8), 10);
  if (isNaN(year) || isNaN(month) || isNaN(day)) return null;
  return { year, month, day };
}

/**
 * Combina la fecha del gamedate y la hora del calendario en un Date UTC,
 * interpretando ambos en la zona horaria de la competición (IANA). Con
 * `Europe/Madrid` (default) el resultado es el histórico; con otra zona, la
 * conversión usa el offset correcto (ver `eu-timezone.ts`).
 */
function combineDateAndTime(
  dateparts: { year: number; month: number; day: number },
  timeStr: string,
  timezone: string
): Date | undefined {
  if (!timeStr || !timeStr.includes(':')) {
    // Sin hora: medianoche en la zona de la competición → UTC.
    return zonedToUtc(timezone, dateparts.year, dateparts.month, dateparts.day, 0, 0);
  }
  const parts = timeStr.split(':').map(Number);
  const h = parts[0];
  const m = parts[1];
  if (h === undefined || m === undefined || isNaN(h) || isNaN(m)) {
    return zonedToUtc(timezone, dateparts.year, dateparts.month, dateparts.day, 0, 0);
  }
  return zonedToUtc(timezone, dateparts.year, dateparts.month, dateparts.day, h, m);
}

function parseScore(scoreText: string): { homeScore?: number; awayScore?: number } {
  if (!scoreText) return {};
  // Formatos: "1 - 4", "1:4", "1-4"
  const match = scoreText.match(/(\d+)\s*[-:]\s*(\d+)/);
  if (!match) return {};
  return {
    homeScore: parseInt(match[1]!, 10),
    awayScore: parseInt(match[2]!, 10),
  };
}

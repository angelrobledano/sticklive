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
import { sidgadPost, SIDGAD_LANG } from './sidgad-client.js';
import { isByeTeamName } from './bye-team.js';
import type { ScrapedMatch, MatchStatus } from '@sports/shared-types';
import { STALE_LIVE_HOURS } from '@sports/shared-types';
import { zonedToUtc } from '../../core/eu-timezone.js';

/** Zona por defecto si la competición no trae una (competitions.timezone). */
const DEFAULT_TIMEZONE = 'Europe/Madrid';

const BASE_URL = 'https://www.server2.sidgad.es/rfep';
const SOURCE_ID = requireFepSourceId();

export interface CalendarScraperConfig {
  /** ID de competición sidgad (ej: "3150" para OK LIGA) */
  idc: string;
  /** ID de temporada en DB (UUID) — para asociar los partidos */
  seasonId: string;
  /** Nombre de la competición (para logging) */
  competitionName?: string;
  /**
   * UUID de la ronda de fase a asignar a todos los partidos (p. ej. la
   * fase de playoff dentro de la temporada de liga). Sin indicar = regular.
   */
  roundId?: string;
  /**
   * Zona IANA en la que la fuente publica las horas (competitions.timezone).
   * Sin indicar = Europe/Madrid (comportamiento histórico).
   */
  timezone?: string;
}

export class FepCalendarScraper extends FepBaseScraper<ScrapedMatch> {
  private calendarConfig: CalendarScraperConfig;

  constructor(config: CalendarScraperConfig) {
    super({
      scraperKey: 'fep_hockey',
      entityType: 'match',
      sourceId: SOURCE_ID,
    });
    this.calendarConfig = config;
  }

  protected async scrape(): Promise<ScrapedMatch[]> {
    const { idc, seasonId, competitionName } = this.calendarConfig;
    const endpointPath = `rfep_cal_idc_${idc}_1.php`;

    this.log.info(
      { idc, competition: competitionName ?? idc },
      'Scrapeando calendario'
    );

    const html = await sidgadPost(endpointPath, {
      idc,
      site_lang: SIDGAD_LANG,
    });

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
    let currentRoundName = '';

    // Recorrer la tabla — thead contiene el nombre de jornada, tbody los partidos
    $('table.tabla_standard').each((_, table) => {
      $(table).find('thead.head_jornada').each((_, thead) => {
        currentRoundName = $(thead).text().trim();
      });

      $(table).find('tbody tr.team_class').each((_, row) => {
        const $row = $(row);
        const errors = this.parseErrors;

        try {
          const match = this.parseMatchRow($, $row, {
            idc,
            seasonId,
            roundName: currentRoundName,
            scrapedAt,
          });
          if (match) matches.push(match);
        } catch (err) {
          this.captureError(errors, err, {
            entityRef: $row.attr('class') ?? 'unknown',
          });
        }
      });
    });

    this.log.info({ idc, total: matches.length }, 'Partidos extraídos del calendario');
    return matches;
  }

  private parseMatchRow(
    $: cheerio.CheerioAPI,
    $row: cheerio.Cheerio<Element>,
    ctx: { idc: string; seasonId: string; roundName: string; scrapedAt: Date }
  ): ScrapedMatch | null {
    // Extraer IDs de equipo desde las clases CSS: team_3408 team_3358
    const classes = ($row.attr('class') ?? '').split(/\s+/);
    const teamClasses = classes.filter((c) => c.startsWith('team_') && c !== 'team_class');
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

    // La fila de descanso (bye) trae a "DESCANSO" como rival, con su propia ref
    // (verificado en Bronce N/S 2026/27). No es un partido: se omite aquí para
    // no emitirlo y acabar con un descarte ruidoso + cola HITL ensuciada.
    if (isByeTeamName(homeTeamName) || isByeTeamName(awayTeamName)) return null;

    // Resultado: celda con clase web_link_td que contiene "1 - 4" o vacío
    const scoreText = $row.find('.web_link_td').first().text().trim();
    const { homeScore, awayScore } = parseScore(scoreText);

    // Estado del partido
    const status = inferStatus(scoreText, scheduledAt);

    // ID del partido (idp) desde el botón de ficha
    const $gameReport = $row.find('i.game_report, a.link_ficha_partido, [idp]');
    const idp = $gameReport.attr('idp') ?? $gameReport.attr('id')?.replace('fichapartido_', '');

    const sourceRef = idp ? `fep_match_${idp}` : undefined;
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
      roundId: this.calendarConfig.roundId,
      roundRef: ctx.roundName || undefined, // nombre de ronda de la fuente (Final, Cuartos…)
      homeTeamRef,
      awayTeamRef,
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

function inferStatus(
  scoreText: string,
  scheduledAt: Date | undefined
): MatchStatus {
  if (scoreText && /\d+\s*[-:]\s*\d+/.test(scoreText)) return 'finished';
  if (!scheduledAt) return 'scheduled';
  const now = new Date();
  if (scheduledAt > now) return 'scheduled';
  // Si la fecha ya paso pero no hay resultado, puede ser live o pendiente
  const hoursSince = (now.getTime() - scheduledAt.getTime()) / 3_600_000;
  if (hoursSince < STALE_LIVE_HOURS) return 'live';
  return 'scheduled'; // datos aun no actualizados
}

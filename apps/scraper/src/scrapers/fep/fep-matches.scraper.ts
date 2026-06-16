/**
 * Scraper de marcadores en vivo / recientes — rfep_mc_1.php
 *
 * Este endpoint devuelve los partidos más recientes y en juego de todas
 * las competiciones activas. Se ejecuta cada pocos minutos para mantener
 * scores y estados actualizados.
 *
 * Estructura de cada elemento <a class="scorer_game ...">:
 *   Atributos:
 *     idp="34267"              — ID del partido (mismo que en el calendario)
 *     idc="3150"               — ID de competición (a veces viene como '$id_liga')
 *     class="... scorer_game_final|pending|live club_71 club_45"
 *       - scorer_game_final    → 'finished'
 *       - scorer_game_pending  → 'scheduled'
 *       - scorer_game_live / otros → 'live'
 *       - club_XX club_YY      → IDs de club local y visitante
 *
 *   Interior:
 *     .scorer_liga             — nombre de la competición (div oculto)
 *     .scorer_team_left        — abreviatura equipo local
 *     .scorer_score            — "6:3" | "1:0" | "" (si está pendiente)
 *     .scorer_team_right       — abreviatura equipo visitante
 *     .scorer_bot_left         — fecha/hora "23/05 12:30"
 *     .scorer_bot_center       — "FINAL" | "PENDIENTE" | "1 CUARTO" | ...
 *     .scorer_bot_right        — fase "2 CUARTOS" | "PLAYOFF" | ...
 *
 * Los partidos pending pueden ser <div> en lugar de <a>.
 * Section headers: .scorer_apartado → nombre de la competición/fase.
 *
 * Propósito: actualizar score + status de partidos ya insertados por
 * FepCalendarScraper. El ETL hace upsert por source_ref = fep_match_{idp},
 * y COALESCE preserva los team_ids ya resueltos del insert inicial.
 */
import * as cheerio from 'cheerio';
import { BaseScraper } from '../../core/base-scraper.js';
import { requireFepSourceId } from '../../core/fep-source.js';
import { sidgadPost } from './sidgad-client.js';
import type { ScrapedMatch, MatchStatus } from '@sports/shared-types';
import fs from 'fs';
import path from 'path';

const BASE_URL = 'https://www.server2.sidgad.es/rfep';
const SOURCE_ID = requireFepSourceId();

export interface MatchesScraperConfig {
  /**
   * UUID de la temporada actual en DB.
   * Se usa como fallback para partidos nuevos que rfep_mc_1.php devuelve
   * pero que el calendario aún no ha cargado. Para actualizaciones de score
   * de partidos ya existentes el ON CONFLICT preserva el season_id original.
   */
  seasonId: string;
}

export class FepMatchesScraper extends BaseScraper<ScrapedMatch> {
  private matchesConfig: MatchesScraperConfig;

  constructor(config: MatchesScraperConfig) {
    super({
      scraperKey: 'fep_hockey',
      entityType: 'match_score',
      sourceId: SOURCE_ID,
    });
    this.matchesConfig = config;
  }

  protected async scrape(): Promise<ScrapedMatch[]> {
    this.log.info('Scrapeando marcadores rfep_mc_1.php');

    // POST sin parámetros — el endpoint devuelve todos los partidos activos
    const html = await sidgadPost('rfep_mc_1.php', {});

    return this.parseMatches(html);
  }

  private parseMatches(html: string): ScrapedMatch[] {
    const $ = cheerio.load(html);
    const matches: ScrapedMatch[] = [];
    const scrapedAt = new Date();

    // Seleccionar tanto <a> como <div> con clase scorer_game
    $('a.scorer_game, div.scorer_game').each((_, el) => {
      const $el = $(el);

      try {
        const match = this.parseMatchElement($, $el, scrapedAt);
        if (match) matches.push(match);
      } catch (err) {
        const idp = $el.attr('idp') ?? 'unknown';
        this.captureError(this.parseErrors, err, { entityRef: `idp_${idp}` });
      }
    });

    this.log.info(
      {
        total: matches.length,
        finished: matches.filter(m => m.status === 'finished').length,
        live: matches.filter(m => m.status === 'live').length,
        scheduled: matches.filter(m => m.status === 'scheduled').length,
      },
      'Marcadores extraídos'
    );

    return matches;
  }

  private parseMatchElement(
    $: cheerio.CheerioAPI,
    $el: cheerio.Cheerio<cheerio.Element>,
    scrapedAt: Date
  ): ScrapedMatch | null {
    const idp = $el.attr('idp');
    if (!idp) return null;

    // Club IDs desde las clases CSS: club_71 club_45
    const classes = ($el.attr('class') ?? '').split(/\s+/);
    const clubClasses = classes.filter(c => c.startsWith('club_') && c !== 'club_');
    const homeClubRef = clubClasses[0]?.replace('club_', '');
    const awayClubRef = clubClasses[1]?.replace('club_', '');

    // Abreviaturas de equipo (fallback para resolución si no hay clubId)
    const homeAbbr = $el.find('.scorer_team_left').text().trim();
    const awayAbbr = $el.find('.scorer_team_right').text().trim();

    if (!homeAbbr && !homeClubRef) return null;
    // Si el equipo visitante no tiene ni club ref ni abreviatura, el elemento
    // está incompleto (partido sin rival asignado aún). Skipeamos.
    if (!awayAbbr && !awayClubRef) return null;

    // Marcador — probar varios selectores porque Playoffs puede usar estructura distinta
    // sidgad usa .scorer_score en liga regular; en eliminatorias a veces cambia
    const SCORE_SELECTORS = [
      '.scorer_score',
      '.marcador',
      '.score',
      '.resultado',
      '[class*="score"]',
      '[class*="marcador"]',
    ] as const;
    let scoreRaw = '';
    let scoreSelector = '';
    for (const sel of SCORE_SELECTORS) {
      const t = $el.find(sel).text().trim();
      if (t && /\d/.test(t)) { scoreRaw = t; scoreSelector = sel; break; }
    }
    const { homeScore, awayScore } = parseScore(scoreRaw);

    // Log de diagnostico — visible en la terminal del scraper cada vez que corre
    // Nota: home_fouls/away_fouls NO estan en rfep_mc_1.php; vienen de match_events
    // (ficha resumen). Aqui solo podemos actualizar score y status.
    console.log('[SCRAPER PARSE]', {
      idp,
      scoreRaw,
      scoreSelector: scoreSelector || '(ninguno)',
      homeScore:   homeScore  ?? null,
      awayScore:   awayScore  ?? null,
      homeFouls:   'n/a (ver match_events)',
      awayFouls:   'n/a (ver match_events)',
      status:      inferStatus(classes, $el.find('.scorer_bot_center').text().trim(), scoreRaw),
      elementHtml: ($el.html() ?? '').slice(0, 400),
    });

    // Vuelca el HTML del partido al disco para diagnóstico sin necesidad de
    // capturar la terminal. Sobrescribe en cada ciclo — siempre tendrás el
    // último estado. Eliminar este bloque una vez identificado el selector.
    try {
      const debugContent = [
        `IDP: ${idp}`,
        `HOME: ${homeAbbr} | AWAY: ${awayAbbr}`,
        `scoreRaw: "${scoreRaw}" | scoreSelector: "${scoreSelector || '(ninguno)'}"`,
        `homeScore: ${homeScore ?? 'null'} | awayScore: ${awayScore ?? 'null'}`,
        `classes: ${classes.join(' ')}`,
        `---HTML---`,
        $el.html() ?? '',
      ].join('\n');
      fs.writeFileSync(
        path.join(process.cwd(), 'debug-playoff.txt'),
        debugContent,
        'utf-8'
      );
    } catch { /* no bloquear el scraper si el disco falla */ }

    // Estado: desde la clase del elemento + texto del botón central
    const statusText = $el.find('.scorer_bot_center').text().trim();
    const status = inferStatus(classes, statusText, scoreRaw);

    // Fecha y hora: "23/05 12:30"
    const dateTimeText = $el.find('.scorer_bot_left').text().trim();
    const scheduledAt = parseDatetime(dateTimeText);

    // Competición (nombre, a veces oculto)
    const competitionName = $el.find('.scorer_liga').text().trim();
    const idcAttr = $el.attr('idc');
    // idc puede ser '$id_liga' (template sin sustituir) — ignoramos en ese caso
    const idc = idcAttr && !idcAttr.startsWith('$') ? idcAttr : undefined;

    // teamRef: preferimos club ID numérico, fallback a abreviatura
    const homeTeamRef = homeClubRef
      ? `fep_club_${homeClubRef}`
      : `fep_abbr_${homeAbbr}`;
    const awayTeamRef = awayClubRef
      ? `fep_club_${awayClubRef}`
      : `fep_abbr_${awayAbbr}`;

    if (this.log.isLevelEnabled('debug')) {
      this.log.debug(
        { idp, home: homeAbbr, away: awayAbbr, score: scoreRaw, status, competition: competitionName },
        'Partido mc parseado'
      );
    }

    return {
      seasonId: this.matchesConfig.seasonId,
      homeTeamRef,
      awayTeamRef,
      homeScore,
      awayScore,
      status,
      scheduledAt: scheduledAt?.toISOString(),
      sourceId: SOURCE_ID,
      sourceRef: `fep_match_${idp}`,
      sourceUrl: `${BASE_URL}/acta_1_${idp}.php`,
      scrapedAt,
    } as ScrapedMatch;
  }

  private get parseErrors(): Array<{ message: string; entityRef?: string }> {
    return [];
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseScore(scoreRaw: string): { homeScore?: number; awayScore?: number } {
  if (!scoreRaw) return {};
  // Normalizar: quitar espacios, unificar separadores (en-dash, em-dash, slash -> guion)
  const normalized = scoreRaw
    .replace(/[\u2013\u2014\u00B7]/g, '-')  // en-dash, em-dash, middle-dot
    .replace(/\s+/g, '');
  // Aceptar separadores : - / (Playoffs a veces usa formatos distintos)
  const m = normalized.match(/^(\d+)[:\-\/](\d+)$/);
  if (!m) return {};
  const h = parseInt(m[1]!, 10);
  const a = parseInt(m[2]!, 10);
  if (isNaN(h) || isNaN(a)) return {};
  return { homeScore: h, awayScore: a };
}

/**
 * Infiere el estado del partido combinando:
 *  - clases CSS del elemento (scorer_game_final / scorer_game_pending)
 *  - texto del botón central (FINAL, PENDIENTE, número de cuarto…)
 *  - presencia de marcador
 */
function inferStatus(
  classes: string[],
  statusText: string,
  scoreRaw: string
): MatchStatus {
  if (classes.includes('scorer_game_final')) return 'finished';
  if (classes.includes('scorer_game_pending')) return 'scheduled';

  const upper = statusText.toUpperCase();
  if (upper === 'FINAL') return 'finished';
  if (upper === 'PENDIENTE' || upper === '') return 'scheduled';

  // "1 CUARTO", "2 CUARTO", "DESCANSO", "EN DIRECTO", etc. → live
  if (scoreRaw && /\d+\s*[:–-]\s*\d+/.test(scoreRaw)) return 'live';

  return 'scheduled';
}

/**
 * Parsea "23/05 12:30" → Date UTC.
 * FEP publica siempre en hora española (Europe/Madrid):
 *   - CEST (UTC+2): último domingo de marzo → último domingo de octubre
 *   - CET  (UTC+1): resto del año
 */
function parseDatetime(text: string): Date | undefined {
  if (!text) return undefined;
  // Formato: "DD/MM HH:MM"
  const m = text.match(/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/);
  if (!m) return undefined;

  const day   = parseInt(m[1]!, 10);
  const month = parseInt(m[2]!, 10) - 1; // 0-based
  const hour  = parseInt(m[3]!, 10);
  const min   = parseInt(m[4]!, 10);

  const now = new Date();
  let year = now.getFullYear();

  // Si el mes está en el futuro lejano, probablemente sea de la temporada anterior
  const candidate = madridToUtc(year, month, day, hour, min);
  if (candidate && candidate.getTime() - now.getTime() > 180 * 24 * 3_600_000) {
    year -= 1;
  }

  return madridToUtc(year, month, day, hour, min);
}

/**
 * Convierte una fecha/hora en zona horaria Europe/Madrid a un Date UTC.
 * Calcula el offset DST sin dependencias externas:
 *   DST empieza: ultimo domingo de marzo a las 02:00 (01:00 UTC), offset +2
 *   DST termina: ultimo domingo de octubre a las 03:00 (01:00 UTC), offset +1
 */
export function madridToUtc(
  year: number, month: number, day: number, hour: number, min: number
): Date {
  const lastSundayOf = (y: number, mo: number): number => {
    // Ultimo domingo del mes mo (0-based). Calcula en UTC puro.
    const lastDay = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
    const dow     = new Date(Date.UTC(y, mo, lastDay)).getUTCDay(); // 0=domingo
    return lastDay - dow;
  };
  // Transiciones expresadas en UTC (momento en que el reloj cambia en Madrid)
  const dstStart = Date.UTC(year, 2, lastSundayOf(year, 2), 1, 0, 0); // Mar -> 01:00 UTC
  const dstEnd   = Date.UTC(year, 9, lastSundayOf(year, 9), 1, 0, 0); // Oct -> 01:00 UTC

  // Primera aproximacion: tratamos la hora como UTC para decidir el offset
  const approxUtc = Date.UTC(year, month, day, hour, min, 0);
  const offset    = (approxUtc >= dstStart && approxUtc < dstEnd) ? 2 : 1; // CEST=+2, CET=+1

  const utcMs = approxUtc - offset * 3_600_000;
  const d = new Date(utcMs);
  return isNaN(d.getTime()) ? new Date(NaN) : d;
}

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
import type { Element } from 'domhandler';
import { FepBaseScraper } from './fep-base-scraper.js';
import { requireFepSourceId } from '../../core/fep-source.js';
import { sidgadPost } from './sidgad-client.js';
import { parseShortDatetime } from './match-datetime.js';
import type { ScrapedMatch, MatchStatus } from '@sports/shared-types';

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

export class FepMatchesScraper extends FepBaseScraper<ScrapedMatch> {
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

  /** Parser puro del feed (público para la batería de casos reales). */
  parseMatches(html: string, scrapedAt: Date = new Date()): ScrapedMatch[] {
    const $ = cheerio.load(html);
    const matches: ScrapedMatch[] = [];

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
    $el: cheerio.Cheerio<Element>,
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
    for (const sel of SCORE_SELECTORS) {
      const t = $el.find(sel).text().trim();
      if (t && /\d/.test(t)) { scoreRaw = t; break; }
    }
    const { homeScore, awayScore } = parseScore(scoreRaw);

    // Nota: home_fouls/away_fouls NO estan en rfep_mc_1.php; vienen de match_events
    // (ficha resumen). Aqui solo podemos actualizar score y status.
    // Estado: desde la clase del elemento + texto del botón central
    const statusText = $el.find('.scorer_bot_center').text().trim();
    const status = inferStatus(classes, statusText);

    // Fecha y hora: "23/05 12:30"
    const dateTimeText = $el.find('.scorer_bot_left').text().trim();
    const scheduledAt = parseDatetime(dateTimeText);

    // Competición (nombre, a veces oculto)
    const competitionName = $el.find('.scorer_liga').text().trim();

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
      competitionName,
      homeTeamAbbr: homeAbbr || undefined,
      awayTeamAbbr: awayAbbr || undefined,
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
}

// ── Helpers ─────────────────────────────────────────────────────────

function parseScore(scoreRaw: string): { homeScore?: number; awayScore?: number } {
  if (!scoreRaw) return {};
  // Normalizar: quitar espacios, unificar separadores (en-dash, em-dash, slash -> guion)
  const normalized = scoreRaw
    .replace(/[–—·]/g, '-')  // en-dash, em-dash, middle-dot
    .replace(/\s+/g, '');
  // Aceptar separadores : - / (Playoffs a veces usa formatos distintos)
  const m = normalized.match(/^(\d+)[:\-/](\d+)$/);
  if (!m) return {};
  const h = parseInt(m[1]!, 10);
  const a = parseInt(m[2]!, 10);
  if (isNaN(h) || isNaN(a)) return {};
  return { homeScore: h, awayScore: a };
}

/**
 * Estado del partido en el feed de directo, SOLO desde señales explícitas:
 *  1. clase CSS del bloque (scorer_game_final / _pending / _playing), que el
 *     feed pone siempre;
 *  2. texto del botón central (FINAL, PENDIENTE, "2 PARTE", DESCANSO…).
 * Sin ninguna de las dos → `undefined` (sin señal: el ETL no toca el estado).
 * Antes, un marcador con dígitos bastaba para declarar `live` y un texto
 * vacío para declarar `scheduled`: dos inferencias que podían reabrir un
 * partido terminado o devolver a "programado" uno en juego.
 */
export function inferStatus(
  classes: string[],
  statusText: string,
): MatchStatus | undefined {
  if (classes.includes('scorer_game_final')) return 'finished';
  if (classes.includes('scorer_game_pending')) return 'scheduled';
  // sidgad marca el directo con `scorer_game_playing` (no `scorer_game_live`).
  // Detectarlo por clase evita depender del marcador (al saque inicial puede
  // venir vacío).
  if (classes.includes('scorer_game_playing') || classes.includes('scorer_game_live')) return 'live';

  const upper = statusText.normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase().trim();
  if (upper === 'FINAL' || upper === 'FINALIZADO') return 'finished';
  if (upper === 'PENDIENTE') return 'scheduled';
  // Periodo/estado de juego publicado por la fuente: "1 PARTE", "2 CUARTO",
  // "DESCANSO", "EN DIRECTO", "PRORROGA", "PENALTIS".
  if (/\b(PARTE|CUARTO|PERIODO|DESCANSO|DIRECTO|PRORROGA|PENALTIS|HALF|PERIOD|LIVE)\b/.test(upper)) return 'live';

  return undefined;
}

function parseDatetime(text: string): Date | undefined {
  return parseShortDatetime(text);
}

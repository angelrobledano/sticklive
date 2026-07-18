/**
 * Scraper de World Skate Europe (europeos de hockey patines).
 *
 * Fuente: worldskate_cal_idc_{IDC}_1.php (misma plataforma sidgad que la FEP,
 * portal 'worldskate'). Una sola respuesta trae TODO el torneo apilado por
 * fases (bloques `content_fase_XXX`): fase de grupos, eliminatorias y
 * consolación, cada una con su calendario y, si aplica, su clasificación.
 *
 * A diferencia de la FEP:
 *   - Calendario y clasificación viven en el MISMO HTML (no en endpoints
 *     separados). Las eliminatorias son filas normales con el nombre de la
 *     ronda en `thead.head_jornada` (FINAL / SEMIS FINALS / QUARTERSFINALS…),
 *     no un cuadro `playoff_box`.
 *   - Los equipos son selecciones nacionales. Las filas de clasificación
 *     traen nombre + bandera pero NO el id `team_XXXX`; se resuelven mapeando
 *     nombre/escudo → id desde el calendario de la misma respuesta.
 *
 * Contrato de refs (la resolución del ETL es global, sin scope por fuente):
 * se emiten refs namespaced `wse_<idSidgad>`, que casan con los sembrados por
 * seed-worldskate-u17.ts.
 *
 * Nota: los partidos se cargan con `round_id` NULL; el nombre de fase/ronda
 * viaja en `roundRef` para cuando exista el upsert de rondas (M5).
 */
import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import type {
  ScrapedMatch, ScrapedStanding, ScrapeResult, MatchStatus, RoundType,
} from '@sports/shared-types';
import { createLogger } from '@sports/logger';
import { SidgadClient } from '../fep/sidgad-client.js';
import { zonedToUtc } from '../../core/eu-timezone.js';

const log = createLogger({ scraper: 'worldskate_hockey' });

// Config de la fuente (coincide con data_sources scraper_key=worldskate_hockey).
const WORLDSKATE = {
  baseUrl: 'https://www.server2.sidgad.es/worldskate',
  portalPrefix: 'worldskate',
  referer: 'https://wse.sidgad.com/',
};
const LOGO_BASE = 'https://www.sidgad.com/worldskate/images/logos_clubes/';
const SCRAPER_KEY = 'worldskate_hockey';

export interface WorldskateScraperConfig {
  /** idc padre de la edición en sidgad (ej: '320' para 2025/26). */
  idc: string;
  /** UUID de la temporada en DB. */
  seasonId: string;
  /** UUID de la fuente (data_sources.id de worldskate_hockey). */
  sourceId: string;
  /** Zona IANA de la sede (ej: 'Europe/Lisbon'). */
  timezone?: string;
  competitionName?: string;
}

export interface WorldskateScrapeOutput {
  matches: ScrapeResult<ScrapedMatch>;
  standings: ScrapeResult<ScrapedStanding>;
}

export class WorldskateScraper {
  private readonly client = new SidgadClient(WORLDSKATE);
  private readonly cfg: WorldskateScraperConfig;

  // Mapas construidos desde el calendario para resolver las clasificaciones,
  // que no traen id de equipo: escudo(fichero) → ref, nombre(normalizado) → ref.
  private logoToRef = new Map<string, string>();
  private nameToRef = new Map<string, string>();

  constructor(cfg: WorldskateScraperConfig) {
    this.cfg = cfg;
  }

  async run(): Promise<WorldskateScrapeOutput> {
    const start = Date.now();
    const { idc, competitionName } = this.cfg;
    log.info({ idc, competition: competitionName ?? idc }, 'Scrapeando World Skate');

    let matches: ScrapedMatch[] = [];
    let standings: ScrapedStanding[] = [];
    const matchErrors: Array<{ message: string; stack?: string }> = [];
    const standErrors: Array<{ message: string; stack?: string }> = [];

    try {
      const html = await this.client.post(`rfep_cal_idc_${idc}_1.php`, {
        idc,
        site_lang: 'es',
      });
      const $ = cheerio.load(html);
      const scrapedAt = new Date();

      // Pasada A: calendarios (todas las fases) → partidos + mapas de resolución.
      matches = this.parseCalendars($, scrapedAt);
      // Pasada B: clasificaciones de grupo → usando los mapas ya poblados.
      standings = this.parseStandings($, scrapedAt);

      log.info({ idc, matches: matches.length, standings: standings.length }, 'Scraping WSE completado');
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      log.error({ err: e }, 'Error fatal en scraper WSE');
      matchErrors.push({ message: e.message, stack: e.stack });
      standErrors.push({ message: e.message, stack: e.stack });
    }

    const durationMs = Date.now() - start;
    return {
      matches: {
        success: matchErrors.length === 0, data: matches, errors: matchErrors,
        durationMs, scraperKey: SCRAPER_KEY, entityType: 'match',
      },
      standings: {
        success: standErrors.length === 0, data: standings, errors: standErrors,
        durationMs, scraperKey: SCRAPER_KEY, entityType: 'standing',
      },
    };
  }

  // ── Pasada A: calendarios ──────────────────────────────────────
  private parseCalendars($: cheerio.CheerioAPI, scrapedAt: Date): ScrapedMatch[] {
    const matches: ScrapedMatch[] = [];
    let phase: Phase = { kind: 'group', title: '' };

    // Recorre, en orden de documento, los títulos de fase y las tablas de
    // calendario, para saber a qué fase pertenece cada tabla.
    $('div.div_titulo_fase_idc, table.table_content_fase').each((_, node) => {
      const $node = $(node);
      if ($node.is('div')) {
        phase = classifyPhase($node.text());
        return;
      }
      // tabla de calendario
      const currentPhase = phase;
      let roundMeta: RoundMeta = { name: '', number: 0, type: 'regular' };

      $node.children('thead.head_jornada, tbody').each((_, child) => {
        const $child = $(child);
        if ($child.is('thead')) {
          roundMeta = computeRound(currentPhase, $child.find('th').first().text());
          return;
        }
        $child.find('tr.team_class').each((_, row) => {
          try {
            const m = this.parseMatchRow($, $(row), roundMeta, scrapedAt);
            if (m) matches.push(m);
          } catch (err) {
            log.warn({ err }, 'Fila de partido WSE no parseada');
          }
        });
      });
    });

    return matches;
  }

  private parseMatchRow(
    $: cheerio.CheerioAPI,
    $row: cheerio.Cheerio<Element>,
    round: RoundMeta,
    scrapedAt: Date
  ): ScrapedMatch | null {
    const classes = ($row.attr('class') ?? '').split(/\s+/);
    const teamClasses = classes.filter((c) => /^team_\d+$/.test(c));
    if (teamClasses.length < 2) return null;

    const homeId = teamClasses[0]!.replace('team_', '');
    const awayId = teamClasses[1]!.replace('team_', '');
    const homeRef = `wse_${homeId}`;
    const awayRef = `wse_${awayId}`;

    // Nombres y escudos (para poblar los mapas usados por las clasificaciones)
    const homeName = $row.find('.nombre_junto_logo').eq(0).text().trim();
    const awayName = $row.find('.nombre_junto_logo').eq(1).text().trim();
    const logos = $row.find('img.team_logo');
    const homeLogo = logoFile(logos.eq(0).attr('src'));
    const awayLogo = logoFile(logos.eq(1).attr('src'));
    this.remember(homeName, homeLogo, homeRef);
    this.remember(awayName, awayLogo, awayRef);

    // Fecha (gamedate="20250719") + hora (primera celda HH:MM)
    const gamedate = parseGamedate($row.attr('gamedate'));
    const timeStr = $row.find('td').filter((_, td) => /^\d{1,2}:\d{2}$/.test($(td).text().trim()))
      .first().text().trim();
    const scheduledAt = gamedate
      ? this.combineDateTime(gamedate, timeStr)
      : undefined;

    // Resultado: la celda web_link_td cuyo texto es "N - N" o "-"
    const scoreText = $row.find('td.web_link_td').filter((_, td) => {
      const t = $(td).text().trim();
      return /^\d+\s*-\s*\d+$/.test(t) || /^-$/.test(t);
    }).first().text().trim();
    const { homeScore, awayScore } = parseScore(scoreText);
    const status = inferStatus(scoreText, scheduledAt);

    // idp (ficha/acta) desde el icono game_report o el enlace link_ficha_partido
    const $report = $row.find('i.game_report, a.link_ficha_partido, [idp]');
    const idp = $report.attr('idp') ?? $report.attr('id')?.replace('fichapartido_', '');
    const sourceRef = idp ? `wse_match_${idp}` : undefined;

    // Enlace de vídeo (europe.worldskate.tv), si existe
    const videoUrl = $row.find('a.fa-video-camera').attr('href') || undefined;

    return {
      seasonId: this.cfg.seasonId,
      roundRef: round.name || undefined,
      roundNumber: round.number || undefined,
      roundType: round.type,
      homeTeamRef: homeRef,
      awayTeamRef: awayRef,
      homeScore,
      awayScore,
      status,
      scheduledAt: scheduledAt?.toISOString(),
      videoUrl,
      sourceId: this.cfg.sourceId,
      sourceRef,
      scrapedAt,
    } as ScrapedMatch;
  }

  // ── Pasada B: clasificaciones de grupo ─────────────────────────
  private parseStandings($: cheerio.CheerioAPI, scrapedAt: Date): ScrapedStanding[] {
    const standings: ScrapedStanding[] = [];

    // Tablas de clasificación: tabla_standard SIN content_fase y con celdas stats_table.
    $('table.tabla_standard').each((_, table) => {
      const $table = $(table);
      if ($table.hasClass('table_content_fase')) return;      // es un calendario
      if ($table.find('td.stats_table').length === 0) return; // no es clasificación

      const groupName = parseGroupName($table.find('thead th').first().text());

      $table.find('tbody tr').each((_, row) => {
        try {
          const s = this.parseStandingRow($, $(row), groupName, scrapedAt);
          if (s) standings.push(s);
        } catch (err) {
          log.warn({ err }, 'Fila de clasificación WSE no parseada');
        }
      });
    });

    return standings;
  }

  private parseStandingRow(
    $: cheerio.CheerioAPI,
    $row: cheerio.Cheerio<Element>,
    groupName: string | undefined,
    scrapedAt: Date
  ): ScrapedStanding | null {
    const cells = $row.find('td');
    if (cells.length < 10) return null;

    const position = parseIntSafe(cells.eq(0).text());
    if (position === undefined) return null;

    const logo = logoFile(cells.eq(1).find('img').attr('src'));
    const name = cells.eq(2).find('.no_mobile').first().text().trim() || cells.eq(2).text().trim();
    if (!name) return null;

    // Resolver ref del equipo vía mapas del calendario (bandera preferente, luego nombre).
    const teamRef =
      (logo && this.logoToRef.get(logo)) ||
      this.nameToRef.get(normName(name)) ||
      name; // fallback: nombre (el ETL intentará por slug)

    return {
      teamRef,
      groupName,
      position,
      points: parseIntSafe(cells.eq(3).text()) ?? 0,
      played: parseIntSafe(cells.eq(4).text()) ?? 0,
      won: parseIntSafe(cells.eq(5).text()) ?? 0,
      drawn: parseIntSafe(cells.eq(6).text()) ?? 0,
      lost: parseIntSafe(cells.eq(7).text()) ?? 0,
      goalsFor: parseIntSafe(cells.eq(8).text()) ?? 0,
      goalsAgainst: parseIntSafe(cells.eq(9).text()) ?? 0,
      logoUrl: logo ? `${LOGO_BASE}${logo}` : undefined,
      sourceId: this.cfg.sourceId,
      scrapedAt,
    } as ScrapedStanding;
  }

  // ── Helpers de instancia ───────────────────────────────────────
  private remember(name: string, logo: string | undefined, ref: string): void {
    if (name) this.nameToRef.set(normName(name), ref);
    if (logo) this.logoToRef.set(logo, ref);
  }

  private combineDateTime(
    d: { year: number; month: number; day: number },
    timeStr: string
  ): Date {
    const [h, m] = timeStr.includes(':')
      ? timeStr.split(':').map((n) => parseInt(n, 10))
      : [0, 0];
    return zonedToUtc(this.cfg.timezone, d.year, d.month, d.day, h ?? 0, m ?? 0);
  }
}

// ── Helpers de módulo ────────────────────────────────────────────
function normName(s: string): string {
  return s.trim().toUpperCase();
}

function logoFile(src: string | undefined): string | undefined {
  if (!src) return undefined;
  return src.split('/').pop() || undefined;
}

function parseGamedate(s: string | undefined): { year: number; month: number; day: number } | null {
  if (!s || s.length !== 8) return null;
  const year = parseInt(s.slice(0, 4), 10);
  const month = parseInt(s.slice(4, 6), 10) - 1;
  const day = parseInt(s.slice(6, 8), 10);
  if (isNaN(year) || isNaN(month) || isNaN(day)) return null;
  return { year, month, day };
}

function parseScore(t: string): { homeScore?: number; awayScore?: number } {
  const m = t.match(/(\d+)\s*-\s*(\d+)/);
  if (!m) return {};
  return { homeScore: parseInt(m[1]!, 10), awayScore: parseInt(m[2]!, 10) };
}

function parseIntSafe(t: string): number | undefined {
  const n = parseInt(t.trim(), 10);
  return isNaN(n) ? undefined : n;
}

function inferStatus(scoreText: string, scheduledAt: Date | undefined): MatchStatus {
  if (scoreText && /\d+\s*-\s*\d+/.test(scoreText)) return 'finished';
  if (!scheduledAt) return 'scheduled';
  const now = new Date();
  if (scheduledAt > now) return 'scheduled';
  const hoursSince = (now.getTime() - scheduledAt.getTime()) / 3_600_000;
  if (hoursSince < 3) return 'live';
  return 'scheduled';
}

// ── Fases y numeración de rondas ─────────────────────────────────
type PhaseKind = 'group' | 'placement' | 'knockout';
interface Phase { kind: PhaseKind; title: string; }
interface RoundMeta { name: string; number: number; type: RoundType; }

/** Clasifica un bloque de fase por su título (div_titulo_fase_idc). */
function classifyPhase(rawTitle: string): Phase {
  const title = rawTitle.replace(/\s+/g, ' ').trim();
  const u = title.toUpperCase();
  if (u.includes('KNOCKOUT')) return { kind: 'knockout', title };
  if (/\d+\s*(TO|A)\s*\d+/.test(u)) return { kind: 'placement', title }; // "5 TO 7"
  return { kind: 'group', title };
}

/**
 * Calcula nombre/número/tipo de ronda a partir de la fase y la cabecera
 * (head_jornada). Esquema de numeración (UNIQUE season+number+type):
 *   - grupos:      Jornada N → number N,        type 'regular'
 *   - consolación: Jornada N → number 50+N,     type 'regular'
 *   - eliminatoria: Cuartos 90 / Semis 95 / 3º-4º 98 / Final 99, type 'playoff'
 */
function computeRound(phase: Phase, theadText: string): RoundMeta {
  const name = normalizeRoundName(theadText);

  if (phase.kind === 'knockout') {
    const number =
      name === 'Cuartos de final' ? 90 :
      name === 'Semifinal'        ? 95 :
      name === '3º y 4º puesto'   ? 98 :
      name === 'Final'            ? 99 : 89;
    return { name, number, type: 'playoff' };
  }

  const jornada = parseInt((name.match(/(\d+)/)?.[1]) ?? '0', 10) || 0;
  if (phase.kind === 'placement') {
    // Prefija el título de la consolación para distinguir en la UI.
    return { name: `${phase.title} · ${name}`.trim(), number: 50 + jornada, type: 'regular' };
  }
  return { name, number: jornada, type: 'regular' };
}

/** Nombre de grupo desde el th: "…GROUP A" → "A" (o undefined si no hay). */
function parseGroupName(thText: string): string | undefined {
  const m = thText.replace(/\s+/g, ' ').match(/GROUP\s+([A-Z0-9]+)/i);
  return m ? m[1] : undefined;
}

/**
 * Normaliza el nombre de la ronda desde el thead.head_jornada.
 * Grupos/consolación: "Giornata Jornada 1" → "Jornada 1".
 * Eliminatorias (EN) → canónico ES.
 */
function normalizeRoundName(raw: string): string {
  const clean = raw.replace(/\s+/g, ' ').trim();
  const num = clean.match(/(\d+)\s*$/);
  if (num && /jornada|giornata/i.test(clean)) return `Jornada ${num[1]}`;

  const u = clean.toUpperCase();
  if (u.includes('SMALL FINAL')) return '3º y 4º puesto';
  if (u.includes('QUARTER')) return 'Cuartos de final';
  if (u.includes('SEMIS') || u.includes('SEMI')) return 'Semifinal';
  if (u.includes('FINAL')) return 'Final';
  return clean;
}

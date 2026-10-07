/**
 * Scraper de World Skate (europeos WSE + World Skate Games, hockey patines).
 *
 * Fuente: worldskate_cal_idc_{IDC}_1.php (misma plataforma sidgad que la FEP,
 * portal 'worldskate'). Una sola respuesta trae TODO el torneo apilado por
 * fases (bloques `content_fase_XXX`): fase de grupos, eliminatorias y
 * consolación, cada una con su calendario y, si aplica, su clasificación.
 *
 * A diferencia de la FEP:
 *   - Calendario y clasificación viven en el MISMO HTML (no en endpoints
 *     separados). Las eliminatorias son filas normales con el nombre de la
 *     ronda en `thead.head_jornada` (FINAL / SEMIFINALS / QUARTERFINALS…),
 *     no un cuadro `playoff_box`.
 *   - Los equipos son selecciones nacionales. Las filas de clasificación
 *     traen nombre + bandera pero NO el id `team_XXXX`; se resuelven mapeando
 *     nombre/escudo → id desde el calendario de la misma respuesta.
 *
 * Fases conocidas (título del bloque `div_titulo_fase_idc`):
 *   - WSE: "GRUPO N" / "KNOCKOUT STAGE" / "FINAL STAGE" / "5 TO 7"…
 *   - WSG ASU26: "GROUP PHASE", "FINAL PHASE" (cuartos → medallas + 5º-8º
 *     por cabeceras) y "5TH - 8TH PLACE" (fase de colocación propia).
 *
 * Participantes dinámicos: las eliminatorias cuya pareja aún no ha decidido
 * la fuente llegan SIN ids ni nombres (solo fecha/hora). Esas filas NO
 * generan partido; la estructura de rondas se emite igualmente (salida
 * `rounds`) para que la UI muestre la fase "por determinar".
 *
 * Contrato de refs (la resolución del ETL es global, sin scope por fuente):
 * se emiten refs namespaced `wse_<idSidgad>`, que casan con los sembrados por
 * seed-worldskate-u17.ts / seed-worldskate-asu26.ts.
 *
 * Nota: los partidos se cargan con `round_id` NULL; el nombre de fase/ronda
 * viaja en `roundRef` y el loader crea las rondas (createRounds).
 */
import * as cheerio from 'cheerio';
import type { CheerioAPI, Cheerio } from 'cheerio';
import type { Element } from 'domhandler';
import type {
  ScrapedMatch, ScrapedRound, ScrapedStanding, ScrapeResult, MatchStatus, RoundType,
} from '@sports/shared-types';
import { STALE_LIVE_HOURS } from '@sports/shared-types';
import { createLogger } from '@sports/logger';
import { SidgadClient } from '../fep/sidgad-client.js';
import { zonedToUtc } from '../../core/eu-timezone.js';
import { emptyMcIdpIndex, gamedateToFechaDM, mcLookupIdp, parseMcIdpIndex, type McIdpIndex } from './mc-idp.js';

const log = createLogger({ scraper: 'worldskate_hockey' });

// Config de la fuente (coincide con data_sources scraper_key=worldskate_hockey).
const WORLDSKATE = {
  baseUrl: 'https://www.server2.sidgad.es/worldskate',
  portalPrefix: 'worldskate',
  referer: 'https://wse.sidgad.com/',
};
// CDN válido para los escudos/banderas de worldskate: los ficheros nuevos
// (WSG ASU26) NO existen bajo www.sidgad.com — solo en sidgad.cloud.
const LOGO_BASE = 'https://sidgad.cloud/worldskate/images/logos_clubes/';
const SCRAPER_KEY = 'worldskate_hockey';

export interface WorldskateScraperConfig {
  /** idc padre de la edición en sidgad (ej: '320' para 2025/26, '325' WSG 2026). */
  idc: string;
  /** UUID de la temporada en DB. */
  seasonId: string;
  /** UUID de la fuente (data_sources.id de worldskate_hockey). */
  sourceId: string;
  /** Zona IANA de la sede (ej: 'Europe/Lisbon', 'America/Asuncion'). */
  timezone?: string;
  competitionName?: string;
}

export interface WorldskateScrapeOutput {
  matches: ScrapeResult<ScrapedMatch>;
  standings: ScrapeResult<ScrapedStanding>;
  /** Estructura de fases/rondas vista en la fuente (incluidas fases sin partidos aún). */
  rounds: ScrapeResult<ScrapedRound>;
}

export class WorldskateScraper {
  private readonly client = new SidgadClient(WORLDSKATE);
  private readonly cfg: WorldskateScraperConfig;

  constructor(cfg: WorldskateScraperConfig) {
    this.cfg = cfg;
  }

  async run(): Promise<WorldskateScrapeOutput> {
    const start = Date.now();
    const { idc, competitionName } = this.cfg;
    log.info({ idc, competition: competitionName ?? idc }, 'Scrapeando World Skate');

    let parsed: WorldskateParsed = { matches: [], standings: [], rounds: [] };
    const errors: Array<{ message: string; stack?: string }> = [];

    try {
      const html = await this.client.post(`rfep_cal_idc_${idc}_1.php`, {
        idc,
        site_lang: 'es',
      });

      // Índice idp del match center: sidgad publica el idp en el mc ANTES que
      // en el calendario (el Colombia-India sub-19 del 7/10 estaba EN DIRECTO
      // con su fila del calendario aún sin idp). Con el índice, los partidos
      // nacen con source_ref real y el acta se pide desde el primer ciclo de
      // directo. Fallo de red → índice vacío (degradación: refs sintéticas y
      // recuperación por la vía de siempre).
      let mcIndex: McIdpIndex = emptyMcIdpIndex();
      try {
        const mcHtml = await this.client.post('worldskate_mc_1.php', {});
        mcIndex = parseMcIdpIndex(mcHtml);
        log.debug({ idps: mcIndex.byDateTime.size }, 'Índice mc de worldskate obtenido');
      } catch (err) {
        log.warn({ err }, 'Match center no disponible — idp solo desde el calendario');
      }

      parsed = parseWorldskateCalendar(html, this.cfg, new Date(), mcIndex);
      log.info(
        { idc, matches: parsed.matches.length, standings: parsed.standings.length, rounds: parsed.rounds.length },
        'Scraping World Skate completado'
      );
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      log.error({ err: e }, 'Error fatal en scraper WSE');
      errors.push({ message: e.message, stack: e.stack });
    }

    const durationMs = Date.now() - start;
    return {
      matches: {
        success: errors.length === 0, data: parsed.matches, errors,
        durationMs, scraperKey: SCRAPER_KEY, entityType: 'match',
      },
      standings: {
        success: errors.length === 0, data: parsed.standings, errors,
        durationMs, scraperKey: SCRAPER_KEY, entityType: 'standing',
      },
      rounds: {
        success: errors.length === 0, data: parsed.rounds, errors,
        durationMs, scraperKey: SCRAPER_KEY, entityType: 'round',
      },
    };
  }
}

// ── Parser puro (testeable sin red) ──────────────────────────────

export interface WorldskateParseConfig {
  seasonId: string;
  sourceId: string;
  timezone?: string;
}

export interface WorldskateParsed {
  matches: ScrapedMatch[];
  standings: ScrapedStanding[];
  rounds: ScrapedRound[];
}

/** Fila de calendario: una fase + una cabecera de ronda + sus filas. */
interface Section {
  phase: Phase;
  headText: string;
  rows: Array<Cheerio<Element>>;
}

/** Bloque de fase (div_titulo_fase_idc) ya clasificado. */
interface Phase { kind: PhaseKind; title: string; }

type PhaseKind = 'group' | 'placement' | 'placement_legacy' | 'knockout';
interface RoundMeta { name: string; number: number; type: RoundType; }

/**
 * Parsea el HTML completo del calendario sidgad de una competición.
 * Pasadas (el orden importa: las clasificaciones no traen id de equipo y
 * necesitan los mapas nombre/escudo → ref que se construyen desde las filas):
 *   A. secciones (fase + cabecera + filas) en orden de documento
 *   B. mapas nombre/escudo → ref desde los calendarios
 *   C. clasificaciones de grupo → además mapa equipo → grupo
 *   D. jornadas de grupo por fecha (los torneos cabecan por día)
 *   E. partidos (filas sin equipos publicados: se saltan, con contador)
 *   F. estructura de rondas (independiente de que haya partidos)
 */
export function parseWorldskateCalendar(
  html: string,
  cfg: WorldskateParseConfig,
  scrapedAt: Date = new Date(),
  mcIndex: McIdpIndex = emptyMcIdpIndex()
): WorldskateParsed {
  const $ = cheerio.load(html);

  const logoToRef = new Map<string, string>();
  const nameToRef = new Map<string, string>();
  const logoToGroup = new Map<string, string>();
  const nameToGroup = new Map<string, string>();
  let sinEquipos = 0;

  // Pasada A: secciones en orden de documento.
  const sections = collectSections($);

  // Pasada B: mapas de identidad desde los calendarios.
  for (const section of sections) {
    for (const $row of section.rows) {
      const ids = teamIdsOf($row);
      for (let i = 0; i < ids.length; i++) {
        const name = $row.find('.nombre_junto_logo').eq(i).text().trim();
        const logo = logoFile($row.find('img.team_logo').eq(i).attr('src'));
        if (name) nameToRef.set(normName(name), `wse_${ids[i]}`);
        if (logo) logoToRef.set(logo, `wse_${ids[i]}`);
      }
    }
  }

  // Pasada C: clasificaciones de grupo (con mapa equipo → grupo).
  const standings = parseStandings($, scrapedAt, cfg, { logoToRef, nameToRef, logoToGroup, nameToGroup });

  // Pasada D: jornada de grupo por fecha (orden cronológico en el torneo).
  const dateToJornada = new Map<string, number>();
  const fechas = new Set<string>();
  for (const section of sections) {
    if (section.phase.kind !== 'group') continue;
    if (jornadaOf(section.headText) > 0) continue; // la fuente ya numera la jornada
    for (const $row of section.rows) {
      const gd = $row.attr('gamedate');
      if (gd && /^\d{8}$/.test(gd)) fechas.add(gd);
    }
  }
  [...fechas].sort().forEach((gd, i) => dateToJornada.set(gd, i + 1));

  // Pasada E: partidos.
  const matches: ScrapedMatch[] = [];
  for (const section of sections) {
    const round = computeRound(section.phase, section.headText, dateToJornada, section.rows[0]?.attr('gamedate'));
    for (const $row of section.rows) {
      try {
        const m = parseMatchRow($, $row, round, scrapedAt, cfg, { logoToRef, nameToRef, logoToGroup, nameToGroup }, mcIndex);
        if (m) matches.push(m);
        else sinEquipos++;
      } catch (err) {
        log.warn({ err }, 'Fila de partido World Skate no parseada');
      }
    }
  }

  // Pasada F: estructura de rondas.
  const byKey = new Map<string, ScrapedRound>();
  for (const section of sections) {
    const round = computeRound(section.phase, section.headText, dateToJornada, section.rows[0]?.attr('gamedate'));
    if (round.number <= 0) continue;
    const key = `${round.number}|${round.type}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        seasonId: cfg.seasonId,
        number: round.number,
        name: round.name || undefined,
        roundType: round.type,
        sourceId: cfg.sourceId,
        scrapedAt,
      });
    }
  }

  if (sinEquipos > 0) {
    log.info(
      { sinEquipos },
      'Eliminatorias con participantes aún sin publicar: rondas emitidas, partidos pendientes de la fuente'
    );
  }

  return { matches, standings, rounds: [...byKey.values()].sort((a, b) => a.number - b.number) };
}

// ── Secciones ────────────────────────────────────────────────────

/**
 * Recorre, en orden de documento, los títulos de fase y las tablas de
 * calendario, agrupando cada thead.head_jornada con sus filas.
 */
function collectSections($: CheerioAPI): Section[] {
  const sections: Section[] = [];
  let phase: Phase = { kind: 'group', title: '' };
  let current: Section | null = null;

  $('div.div_titulo_fase_idc, table.table_content_fase').each((_, node) => {
    const $node = $(node);
    if ($node.is('div')) {
      phase = classifyPhase($node.text());
      return;
    }
    // tabla de calendario: cada thead abre una sección de ronda
    $node.children('thead.head_jornada, tbody').each((_, child) => {
      const $child = $(child);
      if ($child.is('thead')) {
        current = { phase, headText: $child.find('th').first().text(), rows: [] };
        sections.push(current);
        return;
      }
      $child.find('tr.team_class').each((_, row) => {
        current?.rows.push($(row));
      });
    });
  });

  return sections;
}

// ── Partidos ─────────────────────────────────────────────────────

interface RefMaps {
  logoToRef: Map<string, string>;
  nameToRef: Map<string, string>;
  logoToGroup: Map<string, string>;
  nameToGroup: Map<string, string>;
}

function parseMatchRow(
  $: CheerioAPI,
  $row: Cheerio<Element>,
  round: RoundMeta,
  scrapedAt: Date,
  cfg: WorldskateParseConfig,
  maps: RefMaps,
  mcIndex: McIdpIndex
): ScrapedMatch | null {
  const classes = ($row.attr('class') ?? '').split(/\s+/);
  const teamClasses = classes.filter((c) => /^team_\d+$/.test(c));
  if (teamClasses.length < 2) {
    // Eliminatoria con participantes aún sin publicar (WSG): la fila trae
    // fecha/hora pero ni ids ni nombres. El partido se importará cuando la
    // fuente publique a los equipos; la ronda ya se emite como estructura.
    return null;
  }

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
  if (homeName) maps.nameToRef.set(normName(homeName), homeRef);
  if (homeLogo) maps.logoToRef.set(homeLogo, homeRef);
  if (awayName) maps.nameToRef.set(normName(awayName), awayRef);
  if (awayLogo) maps.logoToRef.set(awayLogo, awayRef);

  // Grupo de la fase de grupos: ambos equipos deben ser del MISMO grupo
  // (en eliminatorias vienen de grupos distintos → NULL, que es lo correcto).
  const groupName = resolveGroup(maps, homeName, homeLogo, awayName, awayLogo);

  // Fecha (gamedate="20250719") + hora (primera celda HH:MM)
  const gamedate = parseGamedate($row.attr('gamedate'));
  const timeStr = $row.find('td').filter((_, td) => /^\d{1,2}:\d{2}$/.test($(td).text().trim()))
    .first().text().trim();
  const scheduledAt = gamedate
    ? combineDateTime(cfg.timezone, gamedate, timeStr)
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
  let idp = $report.attr('idp') ?? $report.attr('id')?.replace('fichapartido_', '');

  // Fallback mc (match center): sidgad publica el idp del partido en el mc
  // ANTES que en el calendario — sin él, los partidos nacen con source_ref
  // sintético y su cronología en directo no aparece hasta que la adopción
  // posterior reescriba la ref (ventana de horas, caso Colombia-India sub-19
  // del 7/10). Con el índice, nacen con source_ref real desde el primer
  // scrape. Clave ambigua (dos categorías con los mismos países el mismo día
  // y hora) → sin idp: el partido sigue sintético y se recupera por la
  // adopción del calendario.
  if (!idp) {
    const fechaDM = gamedateToFechaDM($row.attr('gamedate'));
    idp = mcLookupIdp(
      mcIndex,
      [homeLogo, awayLogo].filter((l): l is string => !!l),
      fechaDM,
      timeStr || null
    );
  }
  const sourceRef = idp ? `wse_match_${idp}` : undefined;

  // Enlace de vídeo (europe.worldskate.tv), si existe
  const videoUrl = $row.find('a.fa-video-camera').attr('href') || undefined;

  return {
    seasonId: cfg.seasonId,
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
    groupName: groupName ?? undefined,
    sourceId: cfg.sourceId,
    sourceRef,
    scrapedAt,
  } as ScrapedMatch;
}

/** Grupo compartido de ambos equipos (fase de grupos); undefined si no cuadra. */
function resolveGroup(
  maps: RefMaps,
  homeName: string, homeLogo: string | undefined,
  awayName: string, awayLogo: string | undefined
): string | undefined {
  const home = (homeName && maps.nameToGroup.get(normName(homeName))) || (homeLogo && maps.logoToGroup.get(homeLogo));
  const away = (awayName && maps.nameToGroup.get(normName(awayName))) || (awayLogo && maps.logoToGroup.get(awayLogo));
  if (home && away) return home === away ? home : undefined;
  return home ?? away ?? undefined;
}

// ── Clasificaciones ──────────────────────────────────────────────

function parseStandings(
  $: CheerioAPI,
  scrapedAt: Date,
  cfg: WorldskateParseConfig,
  maps: RefMaps
): ScrapedStanding[] {
  const standings: ScrapedStanding[] = [];

  // Tablas de clasificación: tabla_standard SIN content_fase y con celdas stats_table.
  $('table.tabla_standard').each((_, table) => {
    const $table = $(table);
    if ($table.hasClass('table_content_fase')) return;      // es un calendario
    if ($table.find('td.stats_table').length === 0) return; // no es clasificación

    const groupName = parseGroupName($table.find('thead th').first().text());

    $table.find('tbody tr').each((_, row) => {
      try {
        const s = parseStandingRow($, $(row), groupName, scrapedAt, cfg, maps);
        if (s) {
          if (groupName) {
            // Mapa equipo → grupo (por escudo y por nombre) para etiquetar
            // los partidos de la fase de grupos.
            const rowLogo = logoFile($(row).find('img').attr('src'));
            const rowName = $(row).find('.no_mobile').first().text().trim() || $(row).find('td').eq(2).text().trim();
            if (rowLogo) maps.logoToGroup.set(rowLogo, groupName);
            if (rowName) maps.nameToGroup.set(normName(rowName), groupName);
          }
          standings.push(s);
        }
      } catch (err) {
        log.warn({ err }, 'Fila de clasificación WSE no parseada');
      }
    });
  });

  return standings;
}

function parseStandingRow(
  $: CheerioAPI,
  $row: Cheerio<Element>,
  groupName: string | undefined,
  scrapedAt: Date,
  cfg: WorldskateParseConfig,
  maps: RefMaps
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
    (logo && maps.logoToRef.get(logo)) ||
    maps.nameToRef.get(normName(name)) ||
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
    sourceId: cfg.sourceId,
    scrapedAt,
  } as ScrapedStanding;
}

// ── Helpers de módulo ────────────────────────────────────────────

function normName(s: string): string {
  return s.trim().toUpperCase();
}

/** Ids sidgad de los equipos de una fila ("team_1130 team_1134 team_class"). */
function teamIdsOf($row: Cheerio<Element>): string[] {
  return ($row.attr('class') ?? '').split(/\s+/)
    .filter((c) => /^team_\d+$/.test(c))
    .map((c) => c.replace('team_', ''));
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
  if (hoursSince < STALE_LIVE_HOURS) return 'live';
  return 'scheduled';
}

function combineDateTime(
  timezone: string | undefined,
  d: { year: number; month: number; day: number },
  timeStr: string
): Date {
  const [h, m] = timeStr.includes(':')
    ? timeStr.split(':').map((n) => parseInt(n, 10))
    : [0, 0];
  return zonedToUtc(timezone, d.year, d.month, d.day, h ?? 0, m ?? 0);
}

// ── Fases y numeración de rondas ─────────────────────────────────

/**
 * Clasifica un bloque de fase por su título (div_titulo_fase_idc).
 *   - WSE: "KNOCKOUT STAGE" / "FINAL STAGE" (eliminatoria) y "5 TO 7"
 *     (consolación round-robin).
 *   - WSG ASU26: "FINAL PHASE" (eliminatoria completa, incluida la
 *     colocación 5º-8º por cabeceras) y "5TH - 8TH PLACE" (fase de
 *     colocación propia, una sola ronda).
 */
function classifyPhase(rawTitle: string): Phase {
  const title = rawTitle.replace(/\s+/g, ' ').trim();
  const u = title.toUpperCase();
  if (u.includes('FINAL PHASE') || u.includes('KNOCKOUT') || u.includes('FINAL STAGE')) {
    return { kind: 'knockout', title };
  }
  if (/5TH\s*-\s*8TH\s*(PLACE|POSITION)/.test(u)) return { kind: 'placement', title };
  if (/\d+\s*(TO|A)\s*\d+/.test(u)) return { kind: 'placement_legacy', title }; // "5 TO 7" (WSE)
  return { kind: 'group', title };
}

/** Número canónico de ronda eliminatoria por su nombre canónico ES. */
function knockoutRoundNumber(name: string): number {
  switch (name) {
    case 'Cuartos de final':  return 90;
    case 'Semifinal':         return 95;
    case '3º y 4º puesto':    return 98;
    case 'Final':             return 99;
    // Colocación dentro de la fase final: ordena tras las medallas (WSE
    // usaba 70+primer puesto: 5º-6º → 75, 7º-8º → 77; las semis de la
    // consolación → 74).
    case 'Puestos 5º-8º':     return 74;
    case 'Puestos 5º-6º':     return 75;
    case 'Puestos 7º-8º':     return 77;
    default:                  return 89;
  }
}

/**
 * Calcula nombre/número/tipo de ronda a partir de la sección (fase + cabecera)
 * y, para fases de grupo cabecadas por fecha, el mapa gamedate → jornada.
 * Esquema de numeración (UNIQUE season+number+type):
 *   - grupos:      Jornada N → number N,        type 'regular'
 *   - colocación WSE ("5 TO 7"): Jornada N → 50+N, type 'regular'
 *   - colocación WSG ("5TH - 8TH PLACE"): una ronda única 74 playoff
 *   - eliminatoria: Cuartos 90 / Semis 95 / 3º-4º 98 / Final 99 / Puestos 74-77
 */
function computeRound(
  phase: Phase, headText: string,
  dateToJornada: Map<string, number>,
  gamedate?: string
): RoundMeta {
  if (phase.kind === 'knockout') {
    const name = normalizeRoundName(headText);
    return { name, number: knockoutRoundNumber(name), type: 'playoff' };
  }

  if (phase.kind === 'placement') {
    // Fase de colocación de la WSG (p. ej. "5TH - 8TH PLACE" femenino): la
    // fuente solo la cabeca por fecha; todos sus partidos van en UNA ronda
    // con el nombre canónico de la fase. Los cruces exactos los publica la
    // fuente cuando cierran los grupos.
    const name = normalizeRoundName(phase.title);
    return { name, number: knockoutRoundNumber(name), type: 'playoff' };
  }

  const jornada = jornadaOf(headText);
  if (phase.kind === 'placement_legacy') {
    const name = normalizeRoundName(headText);
    // Prefija el título de la consolación para distinguir en la UI.
    return { name: `${phase.title} · ${name}`.trim(), number: 50 + jornada, type: 'regular' };
  }

  // Fase de grupos: "Jornada N" si la fuente la numera; si la cabecera es una
  // fecha (WSG), jornada = orden cronológico del gamedate en el torneo.
  if (jornada > 0) return { name: `Jornada ${jornada}`, number: jornada, type: 'regular' };
  const porFecha = gamedate && /^\d{8}$/.test(gamedate) ? dateToJornada.get(gamedate) : undefined;
  return { name: `Jornada ${porFecha ?? 0}`, number: porFecha ?? 0, type: 'regular' };
}

/** "Jornada 3" / "Giornata 3" → 3; cabecera de fecha u otra → 0. */
function jornadaOf(headText: string): number {
  const clean = headText.replace(/\s+/g, ' ').trim();
  const num = clean.match(/(\d+)\s*$/);
  if (num && /jornada|giornata/i.test(clean)) return parseInt(num[1] ?? '0', 10);
  return 0;
}

/** Nombre de grupo desde el th del título: "GRUPO GROUP GRUPO A" → "A". */
function parseGroupName(thText: string): string | undefined {
  const clean = thText.replace(/\s+/g, ' ').trim();
  // Caso WSG: th propio del título con la letra al final
  // ("GRUPO GROUP GRUPO A" — las columnas van en otros th).
  const trailing = clean.match(/(?:GRUPO|GROUP|GRUPPO)\s+([A-Z0-9])$/i);
  if (trailing) return trailing[1]!.toUpperCase();
  // Variante con columnas en el mismo th: "…GROUP A PTS …".
  const beforePts = clean.match(/\b([A-Z0-9])\s+(?:PTS|PUNTOS|PT)\b/i);
  if (beforePts) return beforePts[1]!.toUpperCase();
  // Fallback WSE: "…GROUP A". La captura limitada a UN carácter evita que el
  // thead multilenguaje ("GRUPO GROUP GRUPO A…") capture la palabra 'GRUPO'.
  const m = clean.match(/GROUP\s+([A-Z0-9])(?![A-Z0-9])/i);
  return m ? m[1]!.toUpperCase() : undefined;
}

/**
 * Normaliza el nombre de la ronda desde el thead.head_jornada.
 * Grupos/consolación: "Giornata Jornada 1" → "Jornada 1".
 * Eliminatorias (EN, WSE y WSG) → canónico ES.
 */
function normalizeRoundName(raw: string): string {
  const clean = raw.replace(/\s+/g, ' ').trim();
  const num = clean.match(/(\d+)\s*$/);
  if (num && /jornada|giornata/i.test(clean)) return `Jornada ${num[1]}`;

  const u = clean.toUpperCase();
  // WSG ASU26: nombres de fase final en inglés (incluido el typo "BRONCE").
  if (/GOLD\s+MEDAL/.test(u)) return 'Final';
  if (/BRONCE\s+MEDAL|BRONZE\s+MEDAL/.test(u)) return '3º y 4º puesto';
  if (/5TH\s*-\s*8TH\s*(PLACE|POSITION)/.test(u)) return 'Puestos 5º-8º';
  if (/5TH\s*-\s*6TH\s*(PLACE|POSITION)/.test(u)) return 'Puestos 5º-6º';
  if (/7TH\s*-\s*8TH\s*(PLACE|POSITION)/.test(u)) return 'Puestos 7º-8º';
  if (u.includes('SMALL FINAL')) return '3º y 4º puesto';
  if (u.includes('QUARTER')) return 'Cuartos de final';
  if (u.includes('SEMIS') || u.includes('SEMI')) return 'Semifinal';
  if (u.includes('FINAL')) return 'Final';
  // Partido de colocación dentro de la fase final: "5 TO 6" → "Puestos 5º-6º".
  const pl = u.match(/^(\d+)\s*(?:TO|A)\s*(\d+)$/);
  if (pl) return `Puestos ${pl[1]}º-${pl[2]}º`;
  return clean;
}

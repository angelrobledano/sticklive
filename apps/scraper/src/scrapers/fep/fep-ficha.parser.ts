/**
 * Parsers PUROS del acta/ficha de sidgad (rfep_gr / rfep_acta).
 *
 * Todo lo que convierte HTML en datos vive aquí, SIN E/S: ni red, ni base de
 * datos, ni variables de entorno. Esa separación es lo que permite testearlos
 * con HTML real congelado (ver __fixtures__ y fep-ficha.parser.test.ts).
 *
 * Antes esta lógica eran métodos privados de `FepFichaScraper`, un módulo que
 * al importarse llama a `requireFepSourceId()` y carga el cliente de Postgres:
 * cualquier test necesitaba FEP_SOURCE_ID y DATABASE_URL para probar una
 * función que sólo mira un string.
 *
 * El scraper (fep-ficha.scraper.ts) conserva la E/S y consume estas funciones.
 */
import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import type { UpsertMatchLineupInput } from '@sports/db';

/** Logger mínimo que necesita el parser. Inyectable para no acoplarlo a nada. */
export interface ParseLog {
  debug(obj: unknown, msg: string): void;
  info(obj: unknown, msg: string): void;
  warn(obj: unknown, msg: string): void;
}

const SILENT_LOG: ParseLog = { debug: () => {}, info: () => {}, warn: () => {} };

export interface ParseOptions {
  /** Nombre del equipo local: ayuda a decidir el lado en actas ambiguas. */
  homeTeamName?: string;
  /** Logger opcional; por defecto no emite nada (los tests agradecen el silencio). */
  log?: ParseLog;
  /**
   * Prefijo de los `source_ref` de evento. Por defecto `fep_event_`, que es lo
   * que hay cargado en producción desde el principio: cambiarlo reescribiría
   * los refs de la FEP y con ellos los ids, justo lo que la 035 estabilizó.
   * Las fuentes nuevas pasan el suyo (`wse_event_`…) y nacen ya separadas.
   */
  eventPrefix?: string;
}

const DEFAULT_EVENT_PREFIX = 'fep_event_';

/**
 * Referencia estable de un evento, derivada de su CONTENIDO.
 *
 * Antes era `fep_event_{idp}_{rowIdx}`, la posición en la tabla del acta. Y el
 * acta de sidgad se ordena de más nuevo a más viejo: cada incidencia nueva
 * entra por arriba y desplaza a todas las anteriores. Medido sobre tres
 * capturas reales del mismo partido (ver __fixtures__), el MISMO gol aparecía
 * como `_0`, luego `_12`, luego `_33`. 18 de 18 eventos comunes cambiaban de
 * ref entre capturas: el 100%.
 *
 * Con `source_ref` posicional, el upsert de la migración 034 no conserva la
 * identidad — reasigna contenidos a ids existentes y crea ids nuevos para
 * eventos viejos, así que el diff por id del push-dispatcher volvería a
 * notificar todos los goles del partido en cada ciclo.
 *
 * La clave (periodo, crono, tipo, lado) es estable entre capturas y no colisiona
 * en ninguna de las cuatro actas de prueba (6, 18, 38 y 43 eventos). Además se
 * puede recomputar desde las columnas de match_events, que es lo que hace la
 * migración 035 para reescribir las refs históricas sin perder ids.
 *
 * El CRONO es lo que da una ref de contenido plena. Sin él (#375 P3-3) la
 * posición en el acta es inestable —el acta crece por arriba y desplaza las
 * filas—, así que se intenta derivar del resto de contenido observable
 * (periodo, minuto, lado). La posición (`fallbackIdx`) queda como ÚLTIMO
 * recurso, sólo si no hay nada de eso.
 *
 * El periodo, en cambio, puede faltar y no pasa nada: se marca como `px` y la
 * clave sigue siendo de contenido.
 *
 * Esa distinción viene de un caso real: en producción había un evento con
 * crono `00:15` y sin periodo. Exigir ambos lo mandaba a una ref posicional
 * —inestable entre scrapes— justo lo que esta función existe para evitar.
 */
export function eventSourceRef(input: {
  idp: string;
  period: number | undefined;
  clock: string | undefined;
  eventType: FepEventType;
  isHome: boolean | null | undefined;
  fallbackIdx: number;
  /** Minuto transcurrido; sólo se usa para la ref de contenido sin crono. */
  minute?: number | null;
  /** Prefijo de la fuente; por defecto el histórico de la FEP. */
  prefix?: string;
}): string {
  const { idp, period, clock, eventType, isHome, fallbackIdx, minute } = input;
  const prefix = input.prefix ?? DEFAULT_EVENT_PREFIX;
  const side = isHome === true ? 'H' : isHome === false ? 'A' : 'x';
  if (clock) {
    return `${prefix}${idp}_p${period ?? 'x'}_${clock.replace(':', '')}_${eventType}_${side}`;
  }
  // Sin crono: deriva del contenido si queda algo estable (`nc` = no clock).
  const hasContent = period !== undefined || minute != null || isHome === true || isHome === false;
  if (!hasContent) return `${prefix}${idp}_row${fallbackIdx}`;
  return `${prefix}${idp}_nc_p${period ?? 'x'}_m${minute ?? 'x'}_${eventType}_${side}`;
}

/**
 * Sufijo de contenido que desambigua eventos con la misma ref base (#375 P3-2).
 * La ref base (periodo, crono, tipo, lado) puede repetirse —p. ej. dos faltas
 * del mismo equipo en el mismo segundo—; sin desambiguar, el Map de dedup del
 * upsert conservaba uno y perdía el otro en silencio. Se usa el jugador, su
 * dorsal y el detalle, que son estables entre capturas; si no hay nada (dos
 * eventos indistinguibles) se recurre a un ordinal.
 */
function collisionSuffix(e: ScrapedMatchEvent): string {
  const parts: string[] = [];
  if (e.playerName) parts.push(slugifyPlayerName(e.playerName));
  if (e.jerseyNumber != null) parts.push(`j${e.jerseyNumber}`);
  if (e.detail) parts.push(slugifyPlayerName(e.detail));
  return parts.filter(Boolean).join('-');
}

/**
 * Reescribe, in-place, las refs de los eventos que colisionan para que sigan
 * siendo únicas. Los grupos de un solo evento —la inmensa mayoría— quedan
 * intactos: así no se rompe la compatibilidad con los refs que las migraciones
 * 035/036 recomputan desde las columnas (y sus ids estables). El orden se fija
 * por contenido, no por la posición en el acta, para que el sufijo no cambie
 * entre capturas.
 */
export function disambiguateEventRefs(events: ScrapedMatchEvent[]): void {
  const byRef = new Map<string, ScrapedMatchEvent[]>();
  for (const e of events) {
    const group = byRef.get(e.sourceRef);
    if (group) group.push(e);
    else byRef.set(e.sourceRef, [e]);
  }
  for (const [ref, group] of byRef) {
    if (group.length < 2) continue;
    const keyed = group
      .map((e) => ({ e, key: collisionSuffix(e) }))
      .sort((a, b) => a.key.localeCompare(b.key));
    const used = new Set<string>();
    for (const { e, key } of keyed) {
      let suffix = key;
      if (!suffix) {
        let n = 1;
        while (used.has(`ev-${n}`)) n++;
        suffix = `ev-${n}`;
      } else if (used.has(suffix)) {
        let n = 2;
        while (used.has(`${key}-${n}`)) n++;
        suffix = `${key}-${n}`;
      }
      used.add(suffix);
      e.sourceRef = `${ref}_${suffix}`;
    }
  }
}

export type FepEventType = 'goal' | 'penalty' | 'blue_card' | 'red_card' | 'timeout' | 'period_end' | 'foul' | 'direct_foul';

export interface ScrapedMatchEvent {
  /** Tipo de evento normalizado */
  eventType: FepEventType;
  /** Minuto del evento (puede ser null si no figura) */
  minute: number | null;
  /** Periodo / cuarto (1..4) */
  period: number | null;
  /** Tiempo RESTANTE del crono "MM:SS" (el marcador cuenta atrás desde 25:00) */
  clock?: string;
  /** Indicacion de si el evento es del equipo local (true) o visitante (false) */
  isHome: boolean | null;
  /** Nombre del jugador tal como aparece en el HTML (para resolver en ETL) */
  playerName: string | null;
  /** Dorsal del jugador si aparece */
  jerseyNumber: number | null;
  /** Texto libre con detalle adicional (p.ej. "1-0", "GOL PENALTI") */
  detail: string | null;
  /** Ref única para idempotencia, derivada del contenido (ver eventSourceRef). */
  sourceRef: string;
  /** Ref del jugador en sidgad: fep_player_{id_player} (si id_player > 0) */
  playerSourceRef?: string;
  /** Ref sidgad del equipo del jugador (atributo team_id del link, p.ej. "3358") */
  playerTeamRef?: string;
}

export function parseFicha(
  html: string,
  idp: string,
  opts: ParseOptions = {},
): ScrapedMatchEvent[] {
  const log = opts.log ?? SILENT_LOG;
  const $ = cheerio.load(html);
  const events: ScrapedMatchEvent[] = [];

  // Log del HTML en debug para diagnostico en primer run real
  log.debug(
    { idp, htmlLength: html.length, htmlPreview: html.slice(0, 800) },
    'HTML de ficha recibido'
  );

  // ── Estrategia 0: estructura real de rfep_gr_{idp}_1.php ────────────
  // (verificada contra logs/ficha-34277.html, 2026-06-09)
  // Cada incidencia es un <tr> con:
  //   .game_view_indcidencias_period  → "P1" / "P2"   (sic, typo de la fuente)
  //   .game_view_incidencias_time     → "MM:SS" dentro del periodo
  //   td.stats_table .texto_gris_11   → abreviatura del equipo (BAR / IHC)
  //   div.evento_*  > span.lang_es    → tipo: GOL, TARJETA AZUL, TARJETA ROJA,
  //                                     TIEMPO MUERTO, FALTA, AMONESTACIÓN...
  //   a.nombre_ficha_jugador_plus     → jugador; .game_view_incidencias_dorsal → dorsal
  const incidRows = $('tr').filter((_, tr) => $(tr).find('.game_view_indcidencias_period').length > 0);
  if (incidRows.length > 0) {
    // Nombre del equipo local desde la cabecera (.nombre1) para asignar lado
    const homeHeader = normalizeName($('.nombre1').first().text());
    let rowIdx = 0;
    // Instante exacto (crono fuente) por evento — solo para cruzar FD↔gol.
    // Se indexa por el propio objeto y no por `sourceRef` porque el post-proceso
    // de colisiones (#375 P3-2) puede cambiar la ref después de crearlo.
    const rawInstant = new Map<ScrapedMatchEvent, string>();

    incidRows.each((_, tr) => {
      const $tr = $(tr);
      const idx = rowIdx++;

      const periodText = $tr.find('.game_view_indcidencias_period').first().text().trim(); // "P2"
      const timeText   = $tr.find('.game_view_incidencias_time').first().text().trim();    // "03:42"

      // Tipo desde el texto en español del div de evento
      const labelEs = $tr
        .find('div.evento_destacado, div.evento_negativo, div.evento_neutro, div.evento_positivo')
        .first()
        .find('span.lang_es')
        .first()
        .text()
        .trim()
        .toUpperCase();
      if (!labelEs) return;

      const eventType = mapIncidenciaType(labelEs);
      // AMONESTACIÓN VERBAL y similares: sin equivalente en el esquema
      if (!eventType) return;

      // Lado: nombre del equipo al final del div de evento, contrastado con cabecera
      const eventDiv = $tr
        .find('div.evento_destacado, div.evento_negativo, div.evento_neutro, div.evento_positivo')
        .first();
      const teamInEvent = normalizeName(eventDiv.clone().children().remove().end().text());
      const isHome = homeHeader.length > 0 && teamInEvent.length > 0
        ? homeHeader.includes(teamInEvent) || teamInEvent.includes(homeHeader)
        : undefined;

      // Jugador y dorsal
      const $playerLink = $tr.find('a.nombre_ficha_jugador_plus').first();
      const playerName = $playerLink.text().replace(/\s+/g, ' ').trim() || undefined;
      const idPlayerAttr = $playerLink.attr('id_player');
      const playerSourceRef = idPlayerAttr && idPlayerAttr !== '0' ? `fep_player_${idPlayerAttr}` : undefined;
      const playerTeamRef = $playerLink.attr('team_id') || undefined;
      const dorsalText = $tr.find('.game_view_incidencias_dorsal').first().text().trim();
      const jerseyNumber = dorsalText ? parseInt(dorsalText, 10) : undefined;

      const period = periodText ? parseInt(periodText.replace(/\D/g, ''), 10) || undefined : undefined;
      // El crono de la ficha es TIEMPO RESTANTE (cuenta atrás desde 25:00).
      // Convertimos a minuto transcurrido para que la cronología ordene y
      // se lea con la convención habitual ("01:06" restante en P1 → 24').
      const minute = remainingToElapsedMinute(timeText, period);

      // Crono restante normalizado "MM:SS" (el marcador cuenta atrás)
      const clockMatch = timeText?.match(/(\d{1,2})[:.'](\d{2})/);
      const clock = clockMatch
        ? `${clockMatch[1]!.padStart(2, '0')}:${clockMatch[2]}`
        : undefined;

      // Ref derivada del CONTENIDO, no de la posición en la tabla (ver
      // eventSourceRef). `idx` sólo se usa como último recurso.
      const sourceRef = eventSourceRef({
        idp, period, clock, eventType, isHome, fallbackIdx: idx, minute,
        ...(opts.eventPrefix ? { prefix: opts.eventPrefix } : {}),
      });

      const ev = {
        eventType,
        minute: Number.isNaN(minute) ? undefined : minute,
        period,
        clock,
        isHome,
        playerName,
        jerseyNumber: Number.isNaN(jerseyNumber) ? undefined : jerseyNumber,
        detail: null,
        sourceRef,
        playerSourceRef,
        playerTeamRef,
      } as ScrapedMatchEvent;
      events.push(ev);
      rawInstant.set(ev, `${isHome}|${periodText} ${timeText}`);
    });

    // Post-proceso: resultado de las faltas directas. La ficha no lo dice
    // explícitamente, pero si hay un GOL del mismo equipo en el mismo
    // instante exacto del crono, la FD se marcó; si no, se falló.
    const goalsByInstant = new Map<string, ScrapedMatchEvent>();
    for (const e of events) {
      if (e.eventType === 'goal') {
        goalsByInstant.set(rawInstant.get(e) ?? '', e);
      }
    }
    for (const ev of events) {
      if (ev.eventType !== 'direct_foul' && ev.eventType !== 'penalty') continue;
      const goal = goalsByInstant.get(rawInstant.get(ev) ?? '');
      // FD: marcada/fallada · Penalti: marcado/fallado (la API y las stats
      // detectan el acierto buscando 'marc' en detail)
      ev.detail = ev.eventType === 'penalty'
        ? (goal ? 'marcado' : 'fallado')
        : (goal ? 'marcada' : 'fallada');
      // La fuente no informa el lanzador (id_player=0 en FD/penalti), pero
      // si acabó en gol, el goleador del mismo instante es el lanzador.
      if (goal && !ev.playerName) {
        ev.playerName = goal.playerName;
        ev.playerSourceRef = goal.playerSourceRef;
        ev.playerTeamRef = goal.playerTeamRef;
      }
    }

    // Dos incidencias distintas pueden compartir (periodo, crono, tipo, lado):
    // sin este paso el upsert conservaría una y perdería la otra en silencio.
    // Va después del post-proceso para que el desempate pueda usar el detalle
    // (marcado/fallado) y el lanzador resuelto de penaltis y faltas directas.
    disambiguateEventRefs(events);

    log.info(
      { idp, eventsFound: events.length, types: [...new Set(events.map(e => e.eventType))] },
      'Ficha parseada (estructura rfep_gr)'
    );
    return events;
  }

  // ── Estrategia 1: tabla con clase acta / ficha / eventos ────────────
  const ACTA_TABLE_SELECTORS = [
    'table.tabla_acta',
    'table.tabla_ficha',
    'table.tabla_eventos',
    'table.acta_table',
    '#tabla_acta',
    '.div_acta table',
    '.ficha_resumen table',
  ];

  let $table: cheerio.Cheerio<Element> | null = null;
  for (const sel of ACTA_TABLE_SELECTORS) {
    const found = $(sel);
    if (found.length > 0) {
      // .first() devuelve Cheerio<AnyNode>; aquí es una <table>, acotamos.
      $table = found.first() as cheerio.Cheerio<Element>;
      log.info({ selector: sel }, 'Tabla de eventos encontrada');
      break;
    }
  }

  if (!$table) {
    // Log todas las tablas disponibles para debugging
    const tables: string[] = [];
    $('table').each((_, t) => {
      const cls = $(t).attr('class') ?? '';
      const id  = $(t).attr('id')    ?? '';
      const rows = $(t).find('tr').length;
      tables.push(`[class="${cls}" id="${id}" rows=${rows}]`);
    });
    log.warn(
      { idp, tablesFound: tables, divClasses: $('div[class]').map((_, d) => $(d).attr('class')).get().slice(0, 20) },
      'No se encontro tabla de eventos conocida -- revisar HTML'
    );

    // Fallback: intentar parsear filas de cualquier tabla con >= 3 columnas
    $('table').each((tableIdx, table) => {
      const rows = $(table).find('tr');
      if (rows.length < 2) return;
      rows.each((rowIdx, row) => {
        const cells = $(row).find('td');
        if (cells.length < 2) return;
        const ev = tryParseRow($, cells, idp, rowIdx + tableIdx * 1000, opts);
        if (ev) events.push(ev);
      });
    });

    return events;
  }

  // Parsear filas de la tabla encontrada
  $table.find('tbody tr, tr').each((rowIdx, row) => {
    const $row = $(row);
    const cells = $row.find('td');
    if (cells.length < 2) return;
    const ev = tryParseRow($, cells, idp, rowIdx, opts);
    if (ev) events.push(ev);
  });

  log.info(
    { idp, eventsFound: events.length, types: [...new Set(events.map(e => e.eventType))] },
    'Ficha parseada'
  );

  return events;
}

/**
 * Intenta extraer un evento de una fila de tabla.
 * Estrategias de deteccion de tipo de evento:
 *   1. Clase CSS del <img> o <td> (sidgad suele usar clases como "tipo_gol", "tipo_azul")
 *   2. Texto de celda (GOL, G, T.AZUL, TA, FALTA, TIMEOUT, etc.)
 *   3. Alt text de <img>
 */
function tryParseRow(
  $: cheerio.CheerioAPI,
  cells: cheerio.Cheerio<Element>,
  idp: string,
  rowIdx: number,
  opts: ParseOptions = {},
): ScrapedMatchEvent | null {
  const log = opts.log ?? SILENT_LOG;
  const sourceRef = `${opts.eventPrefix ?? DEFAULT_EVENT_PREFIX}${idp}_${rowIdx}`;

  // Concatenar todo el texto de la fila para inspeccion
  const rowText = cells.map((_, c) => $(c).text().trim()).get().join(' | ');
  const rowHtml = cells.map((_, c) => $(c).html() ?? '').get().join(' | ');

  // Detectar tipo de evento
  const eventType = detectEventType($, cells, rowText, rowHtml);
  if (!eventType) {
    log.debug({ rowText: rowText.slice(0, 100), rowIdx }, 'Fila ignorada (sin tipo de evento)');
    return null;
  }

  // Detectar periodo / cuarto
  const period = detectPeriod(rowText);

  // Detectar minuto
  const minute = detectMinute(rowText);

  // Detectar lado (local/visitante)
  const isHome = detectSide($, cells, rowText, opts);

  // Detectar jugador
  const { playerName, jerseyNumber } = detectPlayer($, cells, rowText);

  // Detail
  const detail = buildDetail(eventType, rowText, rowHtml);

  log.debug(
    { rowIdx, eventType, minute, period, isHome, playerName, detail },
    'Evento parseado'
  );

  return { eventType, minute, period, isHome, playerName, jerseyNumber, detail, sourceRef };
}

function detectEventType(
  $: cheerio.CheerioAPI,
  cells: cheerio.Cheerio<Element>,
  rowText: string,
  rowHtml: string
): FepEventType | null {
  const text = rowText.toUpperCase();
  const html = rowHtml.toLowerCase();

  // Por clase CSS o alt de imagen
  const classes = [
    ...cells.map((_, c) => $(c).attr('class') ?? '').get(),
    ...cells.find('img').map((_, img) => ($(img).attr('alt') ?? '') + ' ' + ($(img).attr('class') ?? '')).get(),
  ].join(' ').toLowerCase();

  // GOL
  if (/gol|goal|tipo_gol|clase_gol/.test(classes) || /\bGOL\b|\bG\b|MARCA/.test(text)) return 'goal';
  if (html.includes('gol') && !html.includes('penalti')) return 'goal';

  // PENALTI
  if (/penalt|penalty|tipo_pen/.test(classes) || /PENAL|PEN\b/.test(text)) return 'penalty';
  if (html.includes('penalt')) return 'penalty';

  // TARJETA AZUL (falta)
  if (/azul|blue|t_azul|tipo_azul|falta/.test(classes) || /T\.AZUL|TA\b|AZUL|BLUE|FALTA/.test(text)) return 'blue_card';

  // TARJETA ROJA
  if (/roja|red|t_roja|tipo_roja/.test(classes) || /T\.ROJA|TR\b|ROJA|RED/.test(text)) return 'red_card';

  // TIMEOUT
  if (/timeout|tiempo|t\.muerto|pausa/.test(classes) || /TIMEOUT|T\.MUERTO|TIEMPO MUERTO/.test(text)) return 'timeout';

  // FIN DE PERIODO
  if (/fin.*periodo|fin.*cuarto|period_end|cuarto_fin/.test(classes) || /FIN.*CUARTO|FIN.*PERIODO|DESCANSO|PRORROGA/.test(text)) return 'period_end';

  return null;
}

function detectPeriod(rowText: string): number | null {
  const m = rowText.match(/(\d)[°ºoer]*\s*(?:cuarto|periodo|C\b|Q\b)/i)
         ?? rowText.match(/(?:cuarto|periodo|C|Q)\s*(\d)/i);
  if (m?.[1]) return parseInt(m[1], 10);
  return null;
}

function detectMinute(rowText: string): number | null {
  const m = rowText.match(/(\d{1,3})[''´]?\s*(?:min|'|m\b)/i)
         ?? rowText.match(/\b(\d{1,3})\b.*(?:min|')/i);
  if (m?.[1]) {
    const n = parseInt(m[1], 10);
    return n >= 0 && n <= 120 ? n : null;
  }
  return null;
}

function detectSide(
  $: cheerio.CheerioAPI,
  cells: cheerio.Cheerio<Element>,
  rowText: string,
  opts: ParseOptions = {},
): boolean | null {
  // sidgad suele poner la info del local en columna izquierda (0..n/2)
  // y visitante en la derecha. Buscamos clases como "local", "visitante", "home", "away"
  const allClasses = cells.map((_, c) => $(c).attr('class') ?? '').get().join(' ').toLowerCase();
  if (/\blocal\b|\bhome\b/.test(allClasses)) return true;
  if (/\bvisitante\b|\baway\b/.test(allClasses)) return false;

  if (opts.homeTeamName) {
    const home = opts.homeTeamName.toUpperCase().slice(0, 6);
    if (rowText.toUpperCase().includes(home)) return true;
  }

  return null;
}

function detectPlayer(
  $: cheerio.CheerioAPI,
  cells: cheerio.Cheerio<Element>,
  rowText: string
): { playerName: string | null; jerseyNumber: number | null } {
  // Buscar celda con clase jugador / player / nombre
  let playerCell: cheerio.Cheerio<Element> | null = null;
  cells.each((_, c) => {
    const cls = ($(c).attr('class') ?? '').toLowerCase();
    if (/jugador|player|nombre/.test(cls)) playerCell = $(c);
  });
  const raw = playerCell ? $(playerCell).text().trim() : '';

  // Si no hay celda dedicada, buscar patron "Nro. Apellido Nombre" en rowText
  const jerseyMatch = raw.match(/^(\d{1,2})\s+(.+)/) ?? rowText.match(/\b(\d{1,2})\s+([A-Z][A-Z ,]+)/);
  if (jerseyMatch) {
    return {
      jerseyNumber: parseInt(jerseyMatch[1]!, 10),
      playerName: jerseyMatch[2]!.trim().slice(0, 80),
    };
  }

  return { playerName: raw.slice(0, 80) || null, jerseyNumber: null };
}

function buildDetail(type: FepEventType, rowText: string, _rowHtml: string): string | null {
  if (type === 'goal') {
    const scoreMatch = rowText.match(/(\d+)\s*[-:]\s*(\d+)/);
    return scoreMatch ? `${scoreMatch[1]}-${scoreMatch[2]}` : null;
  }
  if (type === 'penalty') {
    const upper = rowText.toUpperCase();
    if (/GOL|MARC/.test(upper)) return 'marcado';
    if (/PAR|FAL|ERR/.test(upper)) return 'parado';
  }
  return null;
}

// ── Helpers de nombres y de la estructura rfep_gr ────────────────────────────

export function slugifyPlayerName(name: string): string {
  return name
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Normaliza nombres de equipo para comparar (mayúsculas, sin acentos ni símbolos) */
export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

/**
 * Estado en vivo de la cabecera de la ficha (rfep_gr):
 *   #game_period (.periodo_activo) → fase ("PERIODO 1/2" | "DESCANSO" | "FINAL")
 *   #game_time                     → MM:SS RESTANTE del periodo en curso (cuenta atrás).
 * Devuelve null si no hay cabecera de directo (ficha antigua/sin marcador en vivo).
 */
export interface LiveHeader {
  period: number | null;
  clockSeconds: number | null; // restante en el periodo en curso
  isHalftime: boolean;
  /**
   * El acta da el partido por TERMINADO: `#game_period` con clase
   * `periodo_fin` ("FINALIZADO"), frente a `periodo_activo` en juego. Es la
   * señal explícita de final (verificada en actas FEP, playoff y World Skate).
   */
  ended: boolean;
}
export function parseLiveHeader(html: string): LiveHeader | null {
  const $ = cheerio.load(html);
  const $period = $('#game_period, .periodo_activo').first();
  const phase = $period.text().trim().toUpperCase();
  const time  = $('#game_time').first().text().trim();
  if (!phase && !time) return null;
  const ended = $period.hasClass('periodo_fin');
  const isHalftime = /(DESCANS|MEDIO|INTER)/.test(phase);
  const pm = phase.match(/(\d+)/);
  const period = pm ? parseInt(pm[1]!, 10) : null;
  const tm = time.match(/(\d{1,2}):(\d{2})/);
  const clockSeconds = tm ? parseInt(tm[1]!, 10) * 60 + parseInt(tm[2]!, 10) : null;
  return { period, clockSeconds, isHalftime, ended };
}

/**
 * Mapea el texto en español de la incidencia a nuestro tipo de evento.
 * Devuelve null para incidencias sin equivalente en el esquema
 * (FALTA, FALTA DIRECTA, AMONESTACIÓN VERBAL...) — las faltas de equipo
 * van agregadas en la cabecera (report_faltas), no como eventos.
 */
/**
 * Extrae las alineaciones de las tablas competiciones_tabla_basic de la ficha.
 * Estructura por fila (verificada en logs/ficha-34277.html):
 *   td0: dorsal · td1: "P" si portero · col "5i" con "5" si cinco inicial
 *   td nombre: "OKM - APELLIDOS NOMBRE (C)" — prefijo de licencia, (C) capitán
 *   col G: goles del jugador en el partido
 * La primera tabla es el equipo local (coincide con .nombre1), la segunda el visitante.
 */
export function parseLineups(html: string, idp: string): UpsertMatchLineupInput[] {
  const $ = cheerio.load(html);
  const lineups: UpsertMatchLineupInput[] = [];
  const scrapedAt = new Date();

  const homeHeader = $('.nombre1').first().text().replace(/\s+/g, ' ').trim().toUpperCase();

  $('table.competiciones_tabla_basic').each((tableIdx, table) => {
    const $table = $(table);
    const teamName = $table.find('tr').first().text().replace(/\s+/g, ' ').trim().toUpperCase();
    // Lado: por nombre de cabecera; fallback al orden de las tablas (0=local)
    const isHome = homeHeader
      ? teamName.includes(homeHeader) || homeHeader.includes(teamName)
      : tableIdx === 0;

    $table.find('tr').slice(2).each((rowIdx, row) => {
      const cells = $(row).find('td');
      if (cells.length < 4) return;

      const dorsalText = cells.eq(0).text().trim();
      const jerseyNumber = /^\d+$/.test(dorsalText) ? parseInt(dorsalText, 10) : undefined;

      // Cuerpo técnico: sin dorsal, con código de rol en la 2ª celda
      // (E1/E2 = entrenadores, A = auxiliar, D = delegado)
      const roleCode = cells.eq(1).text().trim().toUpperCase();
      if (!dorsalText && /^(E\d?|A|D)$/.test(roleCode)) {
        let staffName = '';
        cells.each((_, c) => {
          const t = $(c).text().replace(/\s+/g, ' ').trim();
          if (t !== roleCode && t.length > staffName.length) staffName = t;
        });
        if (staffName) {
          lineups.push({
            isHome,
            playerName: staffName,
            role: roleCode,
            sourceRef: `fep_lineup_${idp}_${tableIdx}_${rowIdx}`,
            scrapedAt,
          });
        }
        return;
      }

      if (cells.length < 6) return;

      // Nombre del jugador.
      //
      // ANTES se exigía el patrón "XXX - NOMBRE", que es el prefijo de licencia
      // federativa de la FEP ("OKM - PASCUAL MATÍAS"). En una competición de
      // selecciones ese prefijo no existe y el nombre viene limpio
      // ("FAILLA ALESSANDRO"), así que la condición no se cumplía nunca y se
      // descartaban TODOS los jugadores: del Europeo Sub-17 sólo se guardaba el
      // cuerpo técnico, cuya rama no pide ese patrón. 8 filas en vez de 30.
      //
      // Ahora se busca la primera celda con texto de verdad a partir de la 4ª
      // (las anteriores son dorsal, portero, capitán y cinco inicial: códigos
      // de una letra o números). El prefijo de licencia se sigue quitando
      // después si viene, así que la FEP no cambia.
      const NAME_MIN_IDX = 4;
      let rawName = '';
      let nameIdx = -1;
      cells.each((i, c) => {
        if (rawName || i < NAME_MIN_IDX) return;
        const t = $(c).text().replace(/\s+/g, ' ').trim();
        // Al menos dos letras seguidas: descarta "5", "-", "P" y celdas vacías.
        if (t.length >= 3 && /\p{L}{2,}/u.test(t)) { rawName = t; nameIdx = i; }
      });
      if (!rawName) return;

      const isCaptain = /\(C\)/i.test(rawName);
      const playerName = rawName
        .replace(/^[A-Z]{2,4}\s*-\s*/, '')   // prefijo de licencia "OKM - "
        .replace(/\(C\)/gi, '')
        .replace(/\s*\.\s*$/, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!playerName) return;

      // Ref del acta para el jugador (#219): las celdas de nombre de las
      // tablas de alineación traen `id_player` (mismo ancla que las
      // incidencias). Con la REF no hay colisión de homónimos por nombre.
      let playerSourceRef: string | undefined;
      if (nameIdx >= 0) {
        const idPlayer = $(cells[nameIdx]).find('[id_player]').attr('id_player');
        if (idPlayer && idPlayer !== '0') playerSourceRef = `fep_player_${idPlayer}`;
      }

      const isGoalkeeper = cells.eq(1).text().trim().toUpperCase() === 'P';
      // "5" en alguna de las columnas 2-4 = cinco inicial
      const isStarter = [2, 3, 4].some((i) => cells.eq(i).text().trim() === '5');
      // Goles: la columna G es la celda inmediatamente posterior al nombre.
      // (No buscar "primer número tras el nombre": si G está vacía se
      // colaría el valor de columnas posteriores como las faltas.)
      const goalsText = nameIdx >= 0 ? cells.eq(nameIdx + 1).text().trim() : '';
      const goals = /^\d+$/.test(goalsText) ? parseInt(goalsText, 10) : 0;
      // Asistencias: columna "As", justo después de G
      const assistsText = nameIdx >= 0 ? cells.eq(nameIdx + 2).text().trim() : '';
      const assists = /^\d+$/.test(assistsText) ? parseInt(assistsText, 10) : 0;

      lineups.push({
        isHome,
        jerseyNumber,
        playerName,
        playerSourceRef,
        isGoalkeeper,
        isStarter,
        isCaptain,
        goals,
        assists,
        sourceRef: `fep_lineup_${idp}_${tableIdx}_${rowIdx}`,
        scrapedAt,
      });
    });
  });

  return lineups;
}

/**
 * Convierte el crono de la ficha (tiempo RESTANTE, cuenta atrás) en minuto
 * transcurrido del periodo. Partes reglamentarias de 25 min (tpo_reg:25 en
 * sidgad); prórrogas (periodos 3+) de 5 min.
 * "24:54" restante → minuto 1 · "01:06" restante → minuto 24.
 */
export function remainingToElapsedMinute(timeText: string, period?: number): number | undefined {
  const m = timeText.match(/(\d{1,2}):(\d{2})/);
  if (!m) return undefined;
  const remainingSec = parseInt(m[1]!, 10) * 60 + parseInt(m[2]!, 10);
  const periodLengthSec = (period !== undefined && period >= 3 ? 5 : 25) * 60;
  const elapsedSec = Math.max(0, periodLengthSec - remainingSec);
  // Convención deportiva: el primer minuto es el 1'
  return Math.min(Math.ceil(elapsedSec / 60) || 1, periodLengthSec / 60);
}

/**
 * Faltas de equipo desde la cabecera de la ficha.
 * Dos divs .report_faltas: el primero es el equipo local, el segundo el visitante.
 */
export function parseTeamFouls(html: string): { home: number; away: number } | null {
  const $ = cheerio.load(html);
  const vals = $('.report_faltas')
    .map((_, d) => parseInt($(d).text().trim(), 10))
    .get();
  if (vals.length < 2 || vals.some((v) => Number.isNaN(v))) return null;
  return { home: vals[0]!, away: vals[1]! };
}

/**
 * Tanda de penaltis ("LANZAMIENTOS DE PENALTIS" en el acta). La tabla tiene dos
 * columnas (local izquierda, visitante derecha) con un lanzador por fila y un
 * punto de color por resultado: verde = marcado, rojo = fallado, gris (#CCC) =
 * no lanzó. Contamos los verdes de cada lado. Devuelve null si no hubo tanda.
 */
export interface ShootoutKick { player: string; scored: boolean }
export interface ShootoutDetail { home: number; away: number; detail: { home: ShootoutKick[]; away: ShootoutKick[] } }

export function parseShootout(html: string): ShootoutDetail | null {
  const $ = cheerio.load(html);
  // Tabla cuya cabecera dice "LANZAMIENTOS DE PENALTIS" (o "SHOOTOUT").
  const table = $('table').filter((_, t) => {
    const head = $(t).find('thead').text().toUpperCase();
    return head.includes('LANZAMIENTOS DE PENALTIS') || head.includes('SHOOTOUT');
  }).first();
  if (table.length === 0) return null;

  // Las dos columnas al 50% (local izquierda, visitante derecha).
  const sides = table.find('td[width="50%"]');
  if (sides.length < 2) return null;

  // Cada fila de la sub-tabla = un lanzador: nombre + punto de color
  // (verde=marcado, rojo=fallado, gris #CCC=no lanzó → se omite).
  const parseSide = (idx: number): ShootoutKick[] => {
    const kicks: ShootoutKick[] = [];
    sides.eq(idx).find('tr').each((_, tr) => {
      const $tr = $(tr);
      const player = $tr.find('.nombre_ficha_jugador_plus').first().text().replace(/\s+/g, ' ').trim();
      if (!player) return;
      const style = ($tr.find('div[style*="background-color"]').first().attr('style') ?? '').toLowerCase();
      if (style.includes('background-color: #ccc')) return; // no llegó a lanzar
      kicks.push({ player, scored: style.includes('background-color: green') });
    });
    return kicks;
  };

  const home = parseSide(0);
  const away = parseSide(1);
  if (home.length === 0 && away.length === 0) return null;
  return {
    home: home.filter((k) => k.scored).length,
    away: away.filter((k) => k.scored).length,
    detail: { home, away },
  };
}

export function mapIncidenciaType(labelEs: string): FepEventType | null {
  if (labelEs.startsWith('GOL')) return 'goal';
  if (labelEs.includes('PENAL')) return 'penalty';
  if (labelEs.includes('TARJETA AZUL')) return 'blue_card';
  if (labelEs.includes('TARJETA ROJA')) return 'red_card';
  if (labelEs.includes('TIEMPO MUERTO')) return 'timeout';
  if (labelEs.includes('FIN') && labelEs.includes('PERIODO')) return 'period_end';
  if (labelEs.includes('FALTA DIRECTA')) return 'direct_foul'; // antes que FALTA genérica
  if (labelEs.includes('FALTA')) return 'foul';
  // AMONESTACIÓN VERBAL y similares: sin equivalente
  return null;
}

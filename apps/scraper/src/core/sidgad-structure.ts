/**
 * Estructura del calendario de CUALQUIER portal sidgad (FEP, World Skate,
 * FECAPA…): mismos bloques de fase y cabeceras de ronda en todos.
 *
 *   <div class="div_titulo_fase_idc filter_fase_3483">PLAY OFF OK LIGA</div>
 *   <table class="tabla_standard table_content_fase content_fase_3483">
 *     <thead class="head_jornada">1 CUARTOS</thead> <tbody>…filas…</tbody>
 *
 * Funciones puras (sin red ni entorno) para que cualquier scraper las use.
 */
import type * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import type { StructureRow } from '@sports/shared-types';

/**
 * Asocia cada fila de partido con el nombre de fase que la precede.
 *
 * La fuente agrupa por jornada/fase con VARIOS `<thead class="head_jornada">` +
 * su `<tbody>` dentro de la MISMA tabla (p. ej. la Final Four: "SEMIFINALES" y
 * "FINAL"). Coger el último thead etiquetaba TODAS las filas con la última fase
 * (las semifinales salían como "FINAL"). Función pura para poder testearla.
 */
export function collectRoundRows(
  $: cheerio.CheerioAPI,
  table: Element,
): Array<{ roundName: string; row: Element }> {
  const out: Array<{ roundName: string; row: Element }> = [];
  let roundName = '';
  $(table).children().each((_, el) => {
    const tag = (el as Element).tagName;
    if (tag === 'thead') {
      if (!$(el).hasClass('head_jornada')) return;
      // La fuente etiqueta la jornada en varios idiomas (`span.lang_it`,
      // `span.lang_es`…) y `text()` los concatena ("Giornata Jornada 1"). Se
      // quitan los NO activos para quedarnos con el del `site_lang` (es).
      const $th = $(el);
      if ($th.find('.lang_label').length > 0) $th.find('.lang_label').not('.lang_es').remove();
      roundName = $th.text().replace(/\s+/g, ' ').trim();
    } else if (tag === 'tbody') {
      $(el).find('tr.team_class').each((_, row) => {
        out.push({ roundName, row: row as Element });
      });
    }
  });
  return out;
}

/** Texto de un nodo en el idioma activo (es): la fuente apila `span.lang_*`. */
function textEs($: cheerio.CheerioAPI, el: Element): string {
  const $el = $(el).clone();
  if ($el.find('.lang_label').length > 0) $el.find('.lang_label').not('.lang_es').remove();
  return $el.text().replace(/\s+/g, ' ').trim();
}

/** Fila del calendario con su posición en la ESTRUCTURA explícita de la fuente. */
export interface CalendarRow {
  structure: StructureRow;
  row: Element;
}

/**
 * Recorre el calendario en orden de documento y devuelve, por fila, su FASE tal
 * y como la publica la fuente (sidgad, cualquier portal):
 *
 *   <div class="div_titulo_fase_idc filter_fase_3483">PLAY OFF OK LIGA</div>
 *   <table class="tabla_standard table_content_fase content_fase_3483">
 *     <thead class="head_jornada">1 CUARTOS</thead> <tbody>…filas…</tbody>
 *
 * - `phaseRef` = `{portal}_fase_{X}` del `content_fase_X` de la tabla (si un idc
 *   tiene una sola fase, X es el propio idc).
 * - `phaseTitle` = el título que precede a ESA tabla (null si no hay).
 * - Incluye las filas SIN equipos publicados (cruces por decidir): no son
 *   partidos, pero sí estructura (la final existe antes que sus finalistas).
 *
 * El tipo de fase, las fases eliminatorias y el nº de partido de cada serie los
 * decide después `planSourceStructure` (@sports/shared-types). Función pura.
 */
export function collectCalendarRows($: cheerio.CheerioAPI, portal: string): CalendarRow[] {
  const out: CalendarRow[] = [];
  let pendingTitle: string | null = null;
  let currentTitle: string | null = null;
  let tableIndex = 0;
  const titleOfRef = new Map<string, string | null>();
  $('div.div_titulo_fase_idc, table.tabla_standard').each((_, node) => {
    const el = node as Element;
    if (el.tagName === 'div') {
      pendingTitle = textEs($, el) || null;
      return;
    }
    const fase = /content_fase_(\d+)/.exec($(el).attr('class') ?? '')?.[1];
    // Un título nuevo abre fase; varias tablas seguidas sin título siguen en la
    // misma (p. ej. una tabla por jornada bajo "GROUP PHASE").
    if (pendingTitle !== null) currentTitle = pendingTitle;
    pendingTitle = null;
    let phaseRef = `${portal}_fase_${fase ?? `t${tableIndex}`}`;
    // Defensa: mismo content_fase bajo OTRO título → son fases distintas.
    const seen = titleOfRef.get(phaseRef);
    if (seen !== undefined && seen !== currentTitle && currentTitle) {
      phaseRef = `${phaseRef}_${currentTitle.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
    }
    if (!titleOfRef.has(phaseRef)) titleOfRef.set(phaseRef, currentTitle);
    const phaseTitle = currentTitle;
    tableIndex++;
    for (const { roundName, row } of collectRoundRows($, el)) {
      const teams = ($(row).attr('class') ?? '').split(/\s+/)
        .map((c) => /^team_(\d+)$/.exec(c)?.[1])
        .filter((x): x is string => !!x);
      out.push({
        row,
        structure: {
          phaseRef,
          phaseTitle,
          roundLabel: roundName || null,
          date: $(row).attr('gamedate') ?? null,
          homeRef: teams[0] ?? null,
          awayRef: teams[1] ?? null,
          groupName: null,
          docIndex: out.length,
        },
      });
    }
  });
  return out;
}

import { describe, it, expect, vi } from 'vitest';

// El módulo del scraper llama a requireFepSourceId() al importarse (FEP_SOURCE_ID
// obligatorio). vi.hoisted corre ANTES de los imports.
vi.hoisted(() => {
  process.env['FEP_SOURCE_ID'] = '00000000-0000-0000-0000-000000000000';
});

import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { collectRoundRows, extractTeamLogoUrls } from './fep-calendar.scraper.js';

/**
 * Regresión: la fuente agrupa por fase con VARIOS <thead class="head_jornada"> +
 * su <tbody> en la MISMA tabla (Final Four: SEMIFINALES y FINAL). Antes se cogía
 * el último thead y TODAS las filas se etiquetaban con la última fase (las
 * semifinales salían como "FINAL").
 */
function rows(html: string) {
  const $ = cheerio.load(html);
  const table = $('table.tabla_standard').get(0) as Element;
  return collectRoundRows($, table).map((r) => ({ round: r.roundName, cls: $(r.row).attr('class') ?? '' }));
}

const FINAL_FOUR = `
<table class="tabla_standard">
  <thead class="head_jornada"><tr><th colspan="6">SEMIFINALES</th></tr></thead>
  <tbody>
    <tr class="team_3741 team_3688 team_class" gamedate="20261024"><td>1</td><td>2</td><td>16:00</td></tr>
    <tr class="team_3696 team_3690 team_class" gamedate="20261024"><td>1</td><td>2</td><td>18:30</td></tr>
  </tbody>
  <thead class="head_jornada"><tr><th colspan="6">FINAL</th></tr></thead>
  <tbody>
    <tr class="team_3741 team_3696 team_class" gamedate="20261025"><td>1</td><td>2</td><td>15:30</td></tr>
  </tbody>
</table>`;

const LIGA = `
<table class="tabla_standard">
  <thead class="head_jornada"><tr><th>JORNADA 5</th></tr></thead>
  <tbody>
    <tr class="team_1 team_2 team_class" gamedate="20261024"><td>1</td><td>2</td><td>20:00</td></tr>
    <tr class="team_3 team_4 team_class" gamedate="20261024"><td>1</td><td>2</td><td>21:00</td></tr>
  </tbody>
</table>`;

describe('collectRoundRows — fase por fila', () => {
  it('asocia cada fila con el thead que la precede, no con el último', () => {
    const out = rows(FINAL_FOUR);
    expect(out).toHaveLength(3);
    expect(out[0]!.round).toBe('SEMIFINALES');
    expect(out[1]!.round).toBe('SEMIFINALES');
    expect(out[2]!.round).toBe('FINAL');
  });

  it('una liga con un solo thead etiqueta todas las filas igual', () => {
    const out = rows(LIGA);
    expect(out.map((r) => r.round)).toEqual(['JORNADA 5', 'JORNADA 5']);
  });
});

const ROW_CON_LOGOS = `
<table class="tabla_standard"><tbody>
<tr class="team_3741 team_3688 team_class" gamedate="20261024">
  <td>1</td><td>2</td><td>16:00</td>
  <td><img src='https://sidgad.cloud/rfep/images//logos_clubes/44_4.png' class='team_logo'></td>
  <td class="nombre_junto_logo">HOCKEY CLUB LICEO</td>
  <td><img src='https://sidgad.cloud/rfep/images//logos_clubes/vilafranca.png' class='team_logo'></td>
  <td class="nombre_junto_logo">AMETLLER ORIGEN CP VILAFRANCA</td>
</tr>
</tbody></table>`;

describe('extractTeamLogoUrls — escudos de la fila', () => {
  it('devuelve (local, visitante) y normaliza la doble barra del CDN', () => {
    const $ = cheerio.load(ROW_CON_LOGOS);
    const row = $('tr.team_class').get(0) as Element;
    expect(extractTeamLogoUrls($, row)).toEqual([
      'https://sidgad.cloud/rfep/images/logos_clubes/44_4.png',
      'https://sidgad.cloud/rfep/images/logos_clubes/vilafranca.png',
    ]);
  });

  it('sin escudos devuelve null en ambos lados', () => {
    const $ = cheerio.load('<tr class="team_1 team_2 team_class"><td>x</td></tr>');
    const row = $('tr.team_class').get(0) as Element;
    expect(extractTeamLogoUrls($, row)).toEqual([null, null]);
  });
});

const MULTI_LANG = `
<table class="tabla_standard">
  <thead class="head_jornada"><tr><th>
    <span class="lang_label lang_it">Giornata </span>
    <span class="lang_label lang_es">Jornada </span> 3
  </th></tr></thead>
  <tbody>
    <tr class="team_1 team_2 team_class" gamedate="20261024"><td>1</td><td>2</td><td>20:00</td></tr>
  </tbody>
</table>`;

describe('collectRoundRows — etiqueta multi-idioma', () => {
  it('se queda con el idioma activo (es), no concatena "Giornata Jornada 3"', () => {
    const $ = cheerio.load(MULTI_LANG);
    const table = $('table.tabla_standard').get(0) as Element;
    expect(collectRoundRows($, table).map((r) => r.roundName)).toEqual(['Jornada 3']);
  });
});

// ── Estructura de fases y estado SIN reloj ─────────────────────────────────

import { collectCalendarRows, statusFromCalendarScore } from './fep-calendar.scraper.js';

/** Calendario de un idc con DOS fases (como el playoff 3481): título + content_fase_X. */
const PLAYOFF_DOS_FASES = `
<div class="div_titulo_fase_idc filter_fase_3483"><span class="lang_label lang_es">PLAY OFF OK LIGA</span></div>
<table class="tabla_standard table_content_fase content_fase_3483">
  <thead class="head_jornada"><tr><th>1 CUARTOS</th></tr></thead>
  <tbody>
    <tr class="team_3358 team_3387 team_class" gamedate="20260516"><td></td><td>16/05/2026</td><td>16:15</td></tr>
  </tbody>
  <thead class="head_jornada"><tr><th>1 FINAL</th></tr></thead>
  <tbody>
    <tr class="team_3373 team_3408 team_class" gamedate="20260612"><td></td><td>12/06/2026</td><td>20:15</td></tr>
  </tbody>
</table>
<div class="div_titulo_fase_idc filter_fase_3482"><span class="lang_label lang_es">PLAY OFF 9 Y 10</span></div>
<table class="tabla_standard table_content_fase content_fase_3482">
  <thead class="head_jornada"><tr><th>PARTIDO 1</th></tr></thead>
  <tbody>
    <tr class="team_3363 team_3374 team_class" gamedate="20260516"><td></td><td>16/05/2026</td><td>20:00</td></tr>
  </tbody>
</table>`;

/** Liga de un solo bloque sin título (content_fase = idc) y una final sin equipos aún. */
const SIN_TITULO = `
<table class="tabla_standard table_content_fase content_fase_3593">
  <thead class="head_jornada"><tr><th>SEMIFINALES</th></tr></thead>
  <tbody><tr class="team_3388 team_3349 team_class" gamedate="20261023"><td></td><td></td><td>18:45</td></tr></tbody>
  <thead class="head_jornada"><tr><th>FINAL</th></tr></thead>
  <tbody><tr class="team_ team_ team_class" gamedate="20261025"><td></td><td></td><td>11:45</td></tr></tbody>
</table>`;

describe('collectCalendarRows — fase explícita de la fuente por fila', () => {
  it('cada fila lleva su bloque de fase (content_fase_X) y el título que lo precede', () => {
    const $ = cheerio.load(PLAYOFF_DOS_FASES);
    const rows = collectCalendarRows($, 'fep');
    expect(rows.map((r) => [r.structure.phaseRef, r.structure.phaseTitle, r.structure.roundLabel, r.structure.date])).toEqual([
      ['fep_fase_3483', 'PLAY OFF OK LIGA', '1 CUARTOS', '20260516'],
      ['fep_fase_3483', 'PLAY OFF OK LIGA', '1 FINAL', '20260612'],
      ['fep_fase_3482', 'PLAY OFF 9 Y 10', 'PARTIDO 1', '20260516'],
    ]);
    expect(rows.map((r) => r.structure.docIndex)).toEqual([0, 1, 2]);
    expect(rows[0]!.structure.homeRef).toBe('3358');
  });

  it('sin título la fase no tiene nombre; las filas sin equipos también cuentan para la estructura', () => {
    const $ = cheerio.load(SIN_TITULO);
    const rows = collectCalendarRows($, 'fep');
    expect(rows.map((r) => [r.structure.phaseRef, r.structure.phaseTitle, r.structure.roundLabel, r.structure.homeRef])).toEqual([
      ['fep_fase_3593', null, 'SEMIFINALES', '3388'],
      ['fep_fase_3593', null, 'FINAL', null],
    ]);
  });
});

describe('statusFromCalendarScore — el calendario NO sabe si un partido está en juego', () => {
  it('resultado publicado → finished', () => {
    expect(statusFromCalendarScore('1 - 4')).toBe('finished');
    expect(statusFromCalendarScore('10-0')).toBe('finished');
  });

  it('sin resultado → sin señal (undefined), da igual la hora', () => {
    expect(statusFromCalendarScore('')).toBeUndefined();
    expect(statusFromCalendarScore('-')).toBeUndefined();
    expect(statusFromCalendarScore('APLAZADO')).toBeUndefined();
  });
});

describe('collectRoundRows — filas de nota de la fuente', () => {
  it('la nota bajo un partido ("resultado 10-0 por resolución disciplinaria") no es un partido', () => {
    const html = `<table class="tabla_standard content_fase_3483">
      <thead class="head_jornada"><tr><th>1 CUARTOS</th></tr></thead>
      <tbody>
        <tr class="team_3359 team_3332 team_class" gamedate="20260516"><td>16/05/2026</td><td>19:30</td><td>CALAFELL</td><td>REUS</td></tr>
        <tr class="team_3359 team_3332 team_class" gamedate="20260516"><td colspan="18">resultado 10-0 por resolución disciplinaria</td></tr>
      </tbody></table>`;
    const $ = cheerio.load(html);
    const rows = collectRoundRows($, $('table').get(0) as Element);
    expect(rows).toHaveLength(1);
  });
});

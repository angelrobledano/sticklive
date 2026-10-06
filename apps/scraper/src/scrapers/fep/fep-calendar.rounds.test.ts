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

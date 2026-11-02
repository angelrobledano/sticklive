import { describe, it, expect, vi } from 'vitest';

vi.hoisted(() => {
  process.env['FEP_SOURCE_ID'] = '00000000-0000-0000-0000-000000000000';
});

import { FepCalendarScraper } from './fep-calendar.scraper.js';

// Fila real del calendario de OK Liga 2026/27 (31/10/2026), reducida.
const HTML = `
<table class="tabla_standard table_content_fase content_fase_3568" id="my_calendar_table">
  <thead class="head_jornada"><th colspan="17"><div> JORNADA 1 </div></th></thead>
  <tbody>
    <tr class="team_3711 team_3690 team_class" gamedate="20261031">
      <td width="25"></td>
      <td width="75" class="tabla_standard_less"><div>31/10/2026</div></td>
      <td width="45" class="tabla_standard_less">16:10</td>
      <td class="tabla_standard_less" width="120"><div style="text-align:left; padding-left: 5px; font-size: 10px;"> PALAU D'ESPORTS DE REUS </div></td>
      <td class="jor_in_games" style="display: none;"> JORNADA 1 </td>
      <td><img src='https://sidgad.cloud/rfep/images//logos_clubes/reusdep.png' class='team_logo'></td>
      <td><div class="no_mobile nombre_junto_logo">REUS DEPORTIU BRASILIA</div></td>
      <td><img src='https://sidgad.cloud/rfep/images//logos_clubes/calafell.png' class='team_logo'></td>
      <td><div class="no_mobile nombre_junto_logo">CALAFELL LA MENORQUINA</div></td>
      <td></td><td></td><td class="web_link_td"> - </td>
    </tr>
  </tbody>
</table>`;

describe('calendario FEP: pabellón', () => {
  it('guarda el nombre del pabellón de la 4ª celda', () => {
    const s = new FepCalendarScraper({ idc: '3568', seasonId: 's' } as never);
    const [m] = (s as unknown as { parseCalendar(h: string, idc: string, sid: string): Array<{ venueName?: string }> })
      .parseCalendar(HTML, '3568', 's');
    expect(m?.venueName).toBe("PALAU D'ESPORTS DE REUS");
  });
});

import { describe, it, expect } from 'vitest';
import { parseWorldskateCalendar } from './worldskate.scraper.js';
import { parseMcIdpIndex } from './mc-idp.js';

/**
 * Fixture mínimo con la estructura real del calendario sidgad de los World
 * Skate Games (ASU26): fase de grupos cabecada por FECHAS (no por jornadas),
 * fase final con eliminatorias cuyo participante aún no publica la fuente
 * (filas sin ids), fase "5TH - 8TH PLACE" propia del femenino y tablas de
 * clasificación con thead multilenguaje ("GRUPO GROUP GRUPO A PTS …").
 */

const MATCH = (ids: [string, string], logos: [string, string], names: [string, string], date: string, time: string, score = ' - ') => `
  <tr class="team_${ids[0]} team_${ids[1]} team_class" gamedate="${date}">
    <td width="25"></td>
    <td width="75" class="tabla_standard_less"><div style="text-align:left;">${date.slice(6)}/${date.slice(4, 6)}/${date.slice(0, 4)}</div></td>
    <td width="45" class="tabla_standard_less">${time}</td>
    <td class="tabla_standard_less" width="120"><div style="text-align:left;">PABELLON ARENA</div></td>
    <td class="jor_in_games" style="display: none;" width="100">TEST</td>
    <td width="25"><img src='https://sidgad.cloud/worldskate/images//logos_clubes/${logos[0]}.png' width='18' class='team_logo'></td>
    <td width="300"><div class="no_mobile nombre_junto_logo">${names[0]}</div></td>
    <td width="25"><img src='https://sidgad.cloud/worldskate/images//logos_clubes/${logos[1]}.png' width='18' class='team_logo'></td>
    <td width="300"><div class="no_mobile nombre_junto_logo">${names[1]}</div></td>
    <td></td>
    <td class="web_link_td" style="text-align: center;" width="40">${score}</td>
  </tr>`;

const VACIA = (date: string, time: string) => `
  <tr class="team_class" gamedate="${date}">
    <td width="25"></td>
    <td width="75" class="tabla_standard_less"><div style="text-align:left;">x</div></td>
    <td width="45" class="tabla_standard_less">${time}</td>
    <td class="web_link_td" style="text-align: center;" width="40"> - </td>
  </tr>`;

const STANDING = (pos: number, logo: string, name: string, vals: number[]) => `
  <tr>
    <td width="35"><div style="text-align: right;">${pos}</div></td>
    <td width="35"><div class="logo_club_listado"><img src='https://sidgad.cloud/worldskate/images//logos_clubes/${logo}.png' width='16' class='team_logo'></div></td>
    <td><div class="no_mobile">${name}</div><div class="mobile">${name.slice(0, 3)}</div></td>
    <td class="stats_table_special" width="5%">${vals[0]}</td>
    <td class="stats_table" width="5%"><div align="center">${vals[1]}</div></td>
    <td class="stats_table" width="5%"><div align="center">${vals[2]}</div></td>
    <td class="stats_table" width="5%"><div align="center">${vals[3]}</div></td>
    <td class="stats_table" width="5%"><div align="center">${vals[4]}</div></td>
    <td class="stats_table" width="5%"><div align="center">${vals[5]}</div></td>
    <td class="stats_table" width="5%"><div align="center">${vals[6]}</div></td>
  </tr>`;

// Estructura REAL del portal: el título del grupo es un th propio ("GRUPO
// GROUP GRUPO A") y las columnas van en ths separados.
const STANDINGS_TABLE = (grupo: string, filas: string) => `
<table class="tabla_standard">
  <thead>
    <th colspan="3"><span class="lang_label lang_es">GRUPO </span><span class="lang_label lang_en">GROUP </span><span class="lang_label lang_gl">GRUPO </span>${grupo}</th>
    <th><div align="center"><strong>PTS</strong></div></th>
    <th><div align="center">PJ</div></th>
    <th><div align="center">PG</div></th>
    <th><div align="center">PE</div></th>
    <th><div align="center">PP</div></th>
    <th><div align="center">GF</div></th>
    <th><div align="center">GC</div></th>
  </thead>
  <tbody>${filas}</tbody>
</table>`;

const FIXTURE = `
<div class="div_titulo_fase_idc">GROUP PHASE</div>
<table class="tabla_standard table_content_fase content_fase_325">
  <thead class="head_jornada"><th colspan="17"><div style="text-align:left;">12TH OCTOBER</div></th></thead>
  <tbody>${MATCH(['1130', '1134'], ['8_2', '10_1'], ['SPAIN', 'ITALY'], '20261012', '15:30')}</tbody>
</table>
<table class="tabla_standard table_content_fase content_fase_325">
  <thead class="head_jornada"><th colspan="17"><div style="text-align:left;">13TH OCTOBER</div></th></thead>
  <tbody>${MATCH(['1131', '1135'], ['40', '9_1'], ['CHILE', 'ANGOLA'], '20261013', '13:15')}</tbody>
</table>
<div class="div_titulo_fase_idc">FINAL PHASE</div>
<table class="tabla_standard table_content_fase content_fase_325">
  <thead class="head_jornada"><th colspan="17"><div style="text-align:left;">QUARTERFINALS</div></th></thead>
  <tbody>${VACIA('20261015', '11:45')}${VACIA('20261015', '14:30')}</tbody>
  <thead class="head_jornada"><th colspan="17"><div style="text-align:left;">SEMIFINALS</div></th></thead>
  <tbody>${VACIA('20261016', '17:15')}</tbody>
  <thead class="head_jornada"><th colspan="17"><div style="text-align:left;">GOLD MEDAL</div></th></thead>
  <tbody>${VACIA('20261018', '19:00')}</tbody>
  <thead class="head_jornada"><th colspan="17"><div style="text-align:left;">BRONZE MEDAL</div></th></thead>
  <tbody>${VACIA('20261018', '16:15')}</tbody>
  <thead class="head_jornada"><th colspan="17"><div style="text-align:left;">5TH - 8TH POSITION</div></th></thead>
  <tbody>${VACIA('20261016', '11:45')}</tbody>
  <thead class="head_jornada"><th colspan="17"><div style="text-align:left;">5TH - 6TH POSITION</div></th></thead>
  <tbody>${VACIA('20261017', '19:00')}</tbody>
  <thead class="head_jornada"><th colspan="17"><div style="text-align:left;">7TH - 8TH POSITION</div></th></thead>
  <tbody>${VACIA('20261017', '16:15')}</tbody>
</table>
<div class="div_titulo_fase_idc">5TH - 8TH PLACE</div>
<table class="tabla_standard table_content_fase content_fase_329">
  <thead class="head_jornada"><th colspan="17"><div style="text-align:left;">9 OCTOBER</div></th></thead>
  <tbody>${VACIA('20261009', '10:00')}${VACIA('20261009', '12:30')}</tbody>
</table>
${STANDINGS_TABLE('A', STANDING(1, '8_2', 'SPAIN', [6, 2, 2, 0, 0, 11, 2]) + STANDING(2, '10_1', 'ITALY', [3, 2, 1, 0, 1, 5, 4]))}
${STANDINGS_TABLE('B', STANDING(1, '40', 'CHILE', [3, 1, 1, 0, 0, 3, 2]) + STANDING(2, '9_1', 'ANGOLA', [0, 1, 0, 0, 1, 2, 3]))}
`;

const CFG = { seasonId: 'season-1', sourceId: 'source-1', timezone: 'America/Asuncion' };

describe('parseWorldskateCalendar (estructura WSG ASU26)', () => {
  const out = parseWorldskateCalendar(FIXTURE, CFG, new Date('2026-10-06T12:00:00Z'));

  it('solo emite partidos con los dos equipos publicados (las eliminatorias vacías se saltan)', () => {
    expect(out.matches).toHaveLength(2);
    const [primero, segundo] = out.matches;
    expect(primero!.homeTeamRef).toBe('wse_1130');
    expect(primero!.awayTeamRef).toBe('wse_1134');
    expect(segundo!.homeTeamRef).toBe('wse_1131');
  });

  it('jornada de grupo por orden cronológico del gamedate (cabeceras = fechas)', () => {
    const [primero, segundo] = out.matches;
    expect(primero!.roundRef).toBe('Jornada 1');
    expect(primero!.roundNumber).toBe(1);
    expect(primero!.roundType).toBe('regular');
    expect(segundo!.roundRef).toBe('Jornada 2');
    expect(segundo!.roundNumber).toBe(2);
  });

  it('convierte la hora local de Asunción (UTC-3 permanente desde 2024, base IANA) a UTC', () => {
    expect(out.matches[0]!.scheduledAt).toBe('2026-10-12T18:30:00.000Z');
  });

  it('etiqueta el grupo de la fase de grupos (ambos equipos del mismo grupo)', () => {
    expect(out.matches[0]!.groupName).toBe('A');
    expect(out.matches[1]!.groupName).toBe('B');
  });

  it('emite la estructura de rondas completa, incluidas fases sin partidos', () => {
    const rounds = out.rounds.map((r) => `${r.number}|${r.roundType}|${r.name}`);
    expect(rounds).toContain('1|regular|Jornada 1');
    expect(rounds).toContain('2|regular|Jornada 2');
    expect(rounds).toContain('90|playoff|Cuartos de final');
    expect(rounds).toContain('95|playoff|Semifinal');
    expect(rounds).toContain('99|playoff|Final');
    expect(rounds).toContain('98|playoff|3º y 4º puesto');
    expect(rounds).toContain('75|playoff|Puestos 5º-6º');
    expect(rounds).toContain('77|playoff|Puestos 7º-8º');
    // La ronda "5TH - 8TH POSITION" (cabecera dentro de FINAL PHASE) y la fase
    // "5TH - 8TH PLACE" (propia del femenino) son FASES distintas: cada una
    // tiene su ronda 74 (la identidad de ronda incluye la fase, migración 072).
    expect(rounds.filter((r) => r === '74|playoff|Puestos 5º-8º')).toHaveLength(2);
    expect(new Set(out.rounds.filter((r) => r.number === 74).map((r) => r.phaseRef)).size).toBe(2);
    expect(rounds).toHaveLength(10);
  });

  it('clasifica los grupos desde el thead multilenguaje y resuelve refs por escudo', () => {
    expect(out.standings).toHaveLength(4);
    const espana = out.standings.find((s) => s.teamRef === 'wse_1130');
    expect(espana?.groupName).toBe('A');
    expect(espana?.points).toBe(6);
    expect(espana?.played).toBe(2);
    // La URL del escudo usa el CDN VÁLIDO (www.sidgad.com da 404 para los
    // ficheros ASU26 y el standings loader la escribe en teams.logo_url).
    expect(espana?.logoUrl).toBe('https://sidgad.cloud/worldskate/images/logos_clubes/8_2.png');
    const chile = out.standings.find((s) => s.teamRef === 'wse_1131');
    expect(chile?.groupName).toBe('B');
  });

  it('partido con marcador (ya jugado) queda finished', () => {
    const jugado = parseWorldskateCalendar(
      `<div class="div_titulo_fase_idc">GROUP PHASE</div>
       <table class="tabla_standard table_content_fase content_fase_329">
         <thead class="head_jornada"><th colspan="17"><div style="text-align:left;">4TH OCTUBER</div></th></thead>
         <tbody>${MATCH(['1139', '1145'], ['12_1', '33_1'], ['PORTUGAL', 'INDIA'], '20261004', '11:00', '28 - 0')}</tbody>
       </table>`,
      CFG,
      new Date('2026-10-06T12:00:00Z')
    );
    expect(jugado.matches).toHaveLength(1);
    expect(jugado.matches[0]!.status).toBe('finished');
    expect(jugado.matches[0]!.homeScore).toBe(28);
    expect(jugado.matches[0]!.awayScore).toBe(0);
    expect(jugado.matches[0]!.sourceRef).toBeUndefined(); // sin idp → ref sintética del loader
  });
});

describe('adopción del idp vía match center (partidos en directo con cronología desde el minuto uno)', () => {
  // El 7/10 hay Colombia-India en DOS categorías (sub-19 09:15 y absoluta
  // 15:30, mismo par de logos): la hora del mc desambigua. Sin mc, la fila
  // nace sintética y su cronología no aparece hasta la adopción posterior.
  const FIXTURE_MC = `
<a href="#" class="id_fede_1 scorer_game scorer_game_final game_report game_mobile_link game_on_line club_19 club_33" idp="3259" idm='$idm'>
  <div class="scorer_liga">WORLD U19 MEN</div>
  <img src='https://sidgad.cloud/worldskate/images/logos_clubes/19_1.png' width='15'>
  <img src='https://sidgad.cloud/worldskate/images/logos_clubes/33_1.png' width='15'>
  <div class='scorer_bot_left'>07/10 09:15</div>
</a>
<a href="#" class="id_fede_1 scorer_game scorer_game_final game_report game_mobile_link game_on_line club_19 club_33" idp="3265" idm='$idm'>
  <div class="scorer_liga">WORLD CHAMPIONSHIP WOMEN</div>
  <img src='https://sidgad.cloud/worldskate/images/logos_clubes/19_1.png' width='15'>
  <img src='https://sidgad.cloud/worldskate/images/logos_clubes/33_1.png' width='15'>
  <div class='scorer_bot_left'>07/10 15:30</div>
</a>`;
  const CAL_COL_IND = `
<div class="div_titulo_fase_idc">GROUP PHASE</div>
<table class="tabla_standard table_content_fase content_fase_331">
  <thead class="head_jornada"><th colspan="17"><div style="text-align:left;">7TH OCTOBER</div></th></thead>
  <tbody>${MATCH(['1164', '1166'], ['19_1', '33_1'], ['COLOMBIA', 'INDIA'], '20261007', '09:15')}</tbody>
</table>`;

  it('fila sin idp → nace con source_ref real resuelto por el mc (logos+fecha+hora)', () => {
    const out = parseWorldskateCalendar(CAL_COL_IND, CFG, new Date('2026-10-07T10:00:00Z'), parseMcIdpIndex(FIXTURE_MC));
    expect(out.matches).toHaveLength(1);
    expect(out.matches[0]!.homeTeamRef).toBe('wse_1164');
    expect(out.matches[0]!.awayTeamRef).toBe('wse_1166');
    expect(out.matches[0]!.sourceRef).toBe('wse_match_3259');
  });

  it('sin mc (fallo de red) → comportamiento de siempre: ref sintética', () => {
    const out = parseWorldskateCalendar(CAL_COL_IND, CFG, new Date('2026-10-07T10:00:00Z'));
    expect(out.matches[0]!.sourceRef).toBeUndefined();
  });
});

describe('normalizeRoundName (casos de fuente real)', () => {
  // Accedemos vía la salida de rondas de fixtures mínimos por cabecera.
  const roundFor = (fase: string, head: string): string | undefined => {
    const html = `<div class="div_titulo_fase_idc">${fase}</div>
      <table class="tabla_standard table_content_fase">
        <thead class="head_jornada"><th colspan="17"><div style="text-align:left;">${head}</div></th></thead>
        <tbody>${VACIA('20261015', '11:00')}</tbody>
      </table>`;
    return parseWorldskateCalendar(html, CFG, new Date('2026-10-06T12:00:00Z')).rounds[0]?.name;
  };

  it('nombres EN de la WSG → canónico ES', () => {
    expect(roundFor('FINAL PHASE', 'QUARTERFINALS')).toBe('Cuartos de final');
    expect(roundFor('FINAL PHASE', 'SEMIFINALS')).toBe('Semifinal');
    expect(roundFor('FINAL PHASE', 'GOLD MEDAL')).toBe('Final');
    expect(roundFor('FINAL PHASE', 'BRONZE MEDAL')).toBe('3º y 4º puesto');
    expect(roundFor('FINAL PHASE', 'BRONCE MEDAL')).toBe('3º y 4º puesto'); // typo de la fuente (U19)
    expect(roundFor('FINAL PHASE', '5TH - 8TH POSITION')).toBe('Puestos 5º-8º');
    expect(roundFor('FINAL PHASE', '5TH - 6TH POSITION')).toBe('Puestos 5º-6º');
    expect(roundFor('FINAL PHASE', '7TH - 8TH POSITION')).toBe('Puestos 7º-8º');
  });

  it('nombres WSE siguen funcionando (no hay regresión)', () => {
    expect(roundFor('KNOCKOUT STAGE', 'FINAL')).toBe('Final');
    expect(roundFor('KNOCKOUT STAGE', 'SMALL FINAL')).toBe('3º y 4º puesto');
    expect(roundFor('5 TO 7', 'Jornada 1')).toBe('5 TO 7 · Jornada 1');
  });
});

// ── Fases explícitas y estado del directo SIN reloj ────────────────────────

import { parseMcStates } from './mc-idp.js';

describe('estructura de fases de la fuente (mismo planificador que la FEP)', () => {
  const out = parseWorldskateCalendar(FIXTURE, CFG, new Date('2026-10-06T12:00:00Z'));

  it('los partidos de la fase de grupos llevan su fase (groups) y va antes que la fase final', () => {
    expect(out.matches[0]).toMatchObject({ phaseKind: 'groups', phaseIsPlacement: false, stage: null });
    expect(out.matches[0]!.phaseRef).toMatch(/^wse_fase_/);
    const final = out.rounds.find((r) => r.name === 'Final')!;
    expect(out.matches[0]!.phaseOrdinal!).toBeLessThan(final.phaseOrdinal!);
  });

  it('las rondas de la fase final son eliminatorias con su fase canónica', () => {
    const r = (name: string) => out.rounds.find((x) => x.name === name)!;
    expect(r('Cuartos de final')).toMatchObject({ phaseKind: 'knockout', stage: 'quarters', phaseIsPlacement: false });
    expect(r('Semifinal')).toMatchObject({ stage: 'semis' });
    expect(r('Final')).toMatchObject({ stage: 'final' });
    expect(r('3º y 4º puesto')).toMatchObject({ stage: 'third_place' });
    expect(r('Puestos 5º-6º')).toMatchObject({ stage: 'placement' });
  });

  it('la fase "5TH - 8TH PLACE" es de colocación', () => {
    const fases = new Map(out.rounds.map((x) => [x.phaseRef, x]));
    const colocacion = [...fases.values()].find((x) => x.phaseName === '5TH - 8TH PLACE');
    expect(colocacion).toMatchObject({ phaseKind: 'knockout', phaseIsPlacement: true });
  });
});

describe('estado del directo: lo dice el match center, no la hora', () => {
  const CAL_SWT_FRA = `
<div class="div_titulo_fase_idc">GROUP PHASE</div>
<table class="tabla_standard table_content_fase content_fase_329">
  <thead class="head_jornada"><th colspan="17"><div style="text-align:left;">8TH OCTUBER</div></th></thead>
  <tbody>${MATCH(['1146', '1144'], ['13_1', '11_1'], ['SWTZERLAND', 'FRANCE'], '20261008', '13:15')}</tbody>
</table>`;
  const MC_PLAYING = `
<a href="#" class="id_fede_1 scorer_game scorer_game_playing game_report club_13 club_11" idp="3270" idc='$id_liga' idm='$idm'>
  <div class='scorer_logo_left'><img src='https://sidgad.cloud/worldskate/images/logos_clubes/13_1.png' width='15'></div>
  <div class='scorer_score'>2:0</div>
  <div class='scorer_logo_right'><img src='https://sidgad.cloud/worldskate/images/logos_clubes/11_1.png' width='15'></div>
  <div class='scorer_bot_left'>08/10 13:15</div>
  <div class='scorer_bot_center'>PERIOD 1</div>
</a>`;

  it('en juego según el mc → live con el marcador del mc (aunque el calendario diga "-")', () => {
    const o = parseWorldskateCalendar(CAL_SWT_FRA, CFG, new Date('2026-10-08T16:44:00Z'), parseMcIdpIndex(MC_PLAYING), parseMcStates(MC_PLAYING));
    expect(o.matches[0]).toMatchObject({ sourceRef: 'wse_match_3270', status: 'live', homeScore: 2, awayScore: 0 });
  });

  // Caso real (FRA-CHI y ESP-ITA, Mundial masculino 12-13/10/2026): a partir del
  // descanso el calendario publica el marcador PARCIAL ("5 - 2") mientras el mc
  // sigue en "PERIOD 2". Se daban por terminados en el descanso.
  it('el calendario con marcador parcial NO cierra un partido que el mc da en juego', () => {
    const cal = CAL_SWT_FRA.replace(' - </td>', '1 - 0</td>');
    const o = parseWorldskateCalendar(cal, CFG, new Date('2026-10-08T17:00:00Z'), parseMcIdpIndex(MC_PLAYING), parseMcStates(MC_PLAYING));
    expect(o.matches[0]).toMatchObject({ sourceRef: 'wse_match_3270', status: 'live', homeScore: 2, awayScore: 0 });
  });

  it('marcador en el calendario y el mc ya en final → finished', () => {
    const mcFinal = MC_PLAYING.replace('scorer_game_playing', 'scorer_game_final');
    const cal = CAL_SWT_FRA.replace(' - </td>', '3 - 1</td>');
    const o = parseWorldskateCalendar(cal, CFG, new Date('2026-10-08T18:00:00Z'), parseMcIdpIndex(mcFinal), parseMcStates(mcFinal));
    expect(o.matches[0]).toMatchObject({ status: 'finished', homeScore: 3, awayScore: 1 });
  });

  it('pasada la hora y sin señal del mc → SIN estado (no "live" por reloj)', () => {
    const o = parseWorldskateCalendar(CAL_SWT_FRA, CFG, new Date('2026-10-08T17:30:00Z'));
    expect(o.matches[0]!.status).toBeUndefined();
  });

  it('la hora de Asunción se convierte con su zona real (UTC-3)', () => {
    const o = parseWorldskateCalendar(CAL_SWT_FRA, CFG, new Date('2026-10-08T12:00:00Z'));
    expect(o.matches[0]!.scheduledAt).toBe('2026-10-08T16:15:00.000Z');
  });

  it('marcador del mc con local/visitante invertidos respecto al calendario → se reorienta', () => {
    const mcInvertido = MC_PLAYING
      .replace("logos_clubes/13_1.png' width='15'></div>\n  <div class='scorer_score'>2:0</div>\n  <div class='scorer_logo_right'><img src='https://sidgad.cloud/worldskate/images/logos_clubes/11_1.png",
        "logos_clubes/11_1.png' width='15'></div>\n  <div class='scorer_score'>2:0</div>\n  <div class='scorer_logo_right'><img src='https://sidgad.cloud/worldskate/images/logos_clubes/13_1.png");
    const o = parseWorldskateCalendar(CAL_SWT_FRA, CFG, new Date('2026-10-08T16:44:00Z'), parseMcIdpIndex(mcInvertido), parseMcStates(mcInvertido));
    expect(o.matches[0]).toMatchObject({ status: 'live', homeScore: 0, awayScore: 2 });
  });
});

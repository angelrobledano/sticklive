import { describe, it, expect } from 'vitest';
import {
  emptyMcIdpIndex, gamedateToFechaDM, mcLogoKey, mcLookupIdp, parseMcIdpIndex,
} from './mc-idp.js';

/**
 * El mc (worldskate_mc_1.php) publica el idp de los partidos ANTES que el
 * calendario — es la vía para que los partidos en directo tengan cronología
 * desde el minuto uno (el Colombia-India sub-19 del 7/10 estaba EN DIRECTO
 * con su fila del calendario aún sin idp). Fixture con la estructura real:
 * bloques `<a class="... scorer_game ... club_X club_Y" idp="N">` con logos
 * de club, liga y fecha/hora local de la sede.
 */
const FIXTURE = `
<a href="#" class="id_fede_1 scorer_game scorer_game_final game_report game_mobile_link game_on_line club_19 club_33" idp="3259" idc='$id_liga' idm='$idm'>
  <div class="scorer_liga" style="display: none;">WORLD U19 MEN</div>
  <img src='https://sidgad.cloud/worldskate/images/logos_clubes/19_1.png' width='15'>
  <img src='https://sidgad.cloud/worldskate/images/logos_clubes/33_1.png' width='15'>
  <div class='scorer_bot_left'>07/10 09:15</div>
  <div class='scorer_bot_center'>COMPLETED</div>
</a>
<a href="#" class="id_fede_1 scorer_game scorer_game_final game_report game_mobile_link game_on_line club_19 club_33" idp="3265" idc='$id_liga' idm='$idm'>
  <div class="scorer_liga" style="display: none;">WORLD CHAMPIONSHIP WOMEN</div>
  <img src='https://sidgad.cloud/worldskate/images/logos_clubes/19_1.png' width='15'>
  <img src='https://sidgad.cloud/worldskate/images/logos_clubes/33_1.png' width='15'>
  <div class='scorer_bot_left'>07/10 15:30</div>
  <div class='scorer_bot_center'>COMPLETED</div>
</a>
<a href="#" class="id_fede_1 scorer_game scorer_game_final game_report game_mobile_link game_on_line club_12 club_33" idp="3263" idc='$id_liga' idm='$idm'>
  <img src='https://sidgad.cloud/worldskate/images/logos_clubes/12_1.png' width='15'>
  <img src='https://sidgad.cloud/worldskate/images/logos_clubes/33_1.png' width='15'>
  <div class='scorer_bot_left'>07/10 12:00</div>
</a>
<a href="#" class="id_fede_1 scorer_game scorer_game_final game_report game_mobile_link game_on_line club_12 club_33" idp="3266" idc='$id_liga' idm='$idm'>
  <img src='https://sidgad.cloud/worldskate/images/logos_clubes/33_1.png' width='15'>
  <img src='https://sidgad.cloud/worldskate/images/logos_clubes/12_1.png' width='15'>
  <div class='scorer_bot_left'>07/10 12:00</div>
</a>
`;

describe('parseMcIdpIndex', () => {
  const index = parseMcIdpIndex(FIXTURE);

  it('indexa por logos + fecha + hora (el par Colombia-India sub-19 y el absoluto son el mismo día: la hora desambigua)', () => {
    expect(index.byDateTime.get('19_1|33_1|07/10 09:15')).toBe('3259');
    expect(index.byDateTime.get('19_1|33_1|07/10 15:30')).toBe('3265');
  });

  it('descarta la clave solo-fecha cuando es ambigua (dos categorías, mismo par y día)', () => {
    expect(index.byDate.has('19_1|33_1|07/10')).toBe(false);
  });

  it('mantiene la clave solo-fecha cuando es única en su fecha', () => {
    // 12_1|33_1 tiene DOS partidos el 07/10 a la misma hora (3263 y 3266,
    // local/visitante intercambiados) → ambigua también con hora.
    expect(index.byDateTime.has('12_1|33_1|07/10 12:00')).toBe(false);
    expect(index.byDate.has('12_1|33_1|07/10')).toBe(false);
  });
});

describe('mcLookupIdp', () => {
  const index = parseMcIdpIndex(FIXTURE);

  it('resuelve por hora cuando la desambigua', () => {
    expect(mcLookupIdp(index, ['33_1', '19_1'], '07/10', '09:15')).toBe('3259');
    expect(mcLookupIdp(index, ['19_1', '33_1'], '07/10', '15:30')).toBe('3265');
  });

  it('sin hora no resuelve claves ambiguas (el partido sigue sintético)', () => {
    expect(mcLookupIdp(index, ['19_1', '33_1'], '07/10', null)).toBeUndefined();
  });

  it('par ambiguo con misma hora → sin idp', () => {
    expect(mcLookupIdp(index, ['12_1', '33_1'], '07/10', '12:00')).toBeUndefined();
  });

  it('fecha u hora ausentes → undefined sin lanzar', () => {
    expect(mcLookupIdp(index, ['19_1', '33_1'], null, null)).toBeUndefined();
    expect(mcLookupIdp(index, ['19_1', '33_1'], '07/10', null)).toBeUndefined();
  });

  it('índice vacío (fallo de red) → undefined, degradación segura', () => {
    expect(mcLookupIdp(emptyMcIdpIndex(), ['19_1', '33_1'], '07/10', '09:15')).toBeUndefined();
  });
});

describe('helpers', () => {
  it('mcLogoKey ordena y deduplica el par (independiente del local/visitante)', () => {
    expect(mcLogoKey(['33_1', '19_1'])).toBe('19_1|33_1');
    expect(mcLogoKey(['19_1', '33_1', '19_1'])).toBe('19_1|33_1');
  });

  it('gamedateToFechaDM: gamedate local de la sede → DD/MM del formato del mc', () => {
    expect(gamedateToFechaDM('20261007')).toBe('07/10');
    expect(gamedateToFechaDM('20261012')).toBe('12/10');
    expect(gamedateToFechaDM(undefined)).toBeNull();
    expect(gamedateToFechaDM('basura')).toBeNull();
  });
});

// ── Estado explícito del match center y colisiones entre categorías ─────────

import { parseMcStates } from './mc-idp.js';

/** Bloques reales del 8/10/2026 (WSG Asunción), recortados. */
const DIRECTO = `
<a href="#" class="id_fede_1 scorer_game scorer_game_playing game_report club_19 club_10" idp="3359" idc='$id_liga' idm='$idm'>
  <div class="scorer_liga" style="display: none;">FINAL PHASE</div>
  <div class='scorer_logo_left'><img src='https://sidgad.cloud/worldskate/images/logos_clubes/19_1.png' width='15'></div>
  <div class='scorer_team_left'>COL</div>
  <div class='scorer_score'>
            1:11
  </div>
  <div class='scorer_team_right'>ITA</div>
  <div class='scorer_logo_right'><img src='https://sidgad.cloud/worldskate/images/logos_clubes/10_1.png' width='15'></div>
  <div class='scorer_bot_left'>08/10 12:30</div>
  <div class='scorer_bot_center'>PERIOD 2</div>
</a>
<a href="#" class="id_fede_1 scorer_game scorer_game_final game_report club_25 club_12" idp="3273" idc='$id_liga' idm='$idm'>
  <div class='scorer_logo_left'><img src='https://sidgad.cloud/worldskate/images/logos_clubes/25.png' width='15'></div>
  <div class='scorer_score'>1:19</div>
  <div class='scorer_logo_right'><img src='https://sidgad.cloud/worldskate/images/logos_clubes/12_1.png' width='15'></div>
  <div class='scorer_bot_left'>08/10 11:00</div>
  <div class='scorer_bot_center'>COMPLETED</div>
</a>
<div class="id_fede_1 scorer_game scorer_game_pending club_33 club_22" idp="3271" idc="329" idm="1">
  <div class="scorer_liga" style="display: none;">WORLD CHAMPIONSHIP WOMEN</div>
</div>
`;

describe('parseMcStates — el estado EXPLÍCITO de la fuente (no el reloj)', () => {
  const states = parseMcStates(DIRECTO);

  it('playing → live con marcador en vivo y logos de cada lado', () => {
    expect(states.get('3359')).toEqual({ status: 'live', homeScore: 1, awayScore: 11, leftLogo: '19_1', rightLogo: '10_1' });
  });

  it('final → finished con su resultado', () => {
    expect(states.get('3273')).toMatchObject({ status: 'finished', homeScore: 1, awayScore: 19 });
  });

  it('pending → scheduled (aunque no traiga marcador ni logos)', () => {
    expect(states.get('3271')).toEqual({ status: 'scheduled', homeScore: undefined, awayScore: undefined, leftLogo: null, rightLogo: null });
  });
});

describe('mcLookupIdp — no cruza categorías', () => {
  it('una fila con hora NO se resuelve por la clave solo-fecha de un bloque con OTRA hora', () => {
    // Bug real 8/10: el ITA-COL femenino (17:45, sin idp aún) se llevaba el idp
    // del cuarto de final sub-19 COL-ITA (12:30) por compartir logos y día.
    const index = parseMcIdpIndex(DIRECTO);
    expect(mcLookupIdp(index, ['10_1', '19_1'], '08/10', '17:45')).toBeUndefined();
    expect(mcLookupIdp(index, ['10_1', '19_1'], '08/10', '12:30')).toBe('3359');
  });

  it('sin hora en la fila, la clave solo-fecha sigue valiendo si es única', () => {
    const index = parseMcIdpIndex(DIRECTO);
    expect(mcLookupIdp(index, ['10_1', '19_1'], '08/10', null)).toBe('3359');
  });
});

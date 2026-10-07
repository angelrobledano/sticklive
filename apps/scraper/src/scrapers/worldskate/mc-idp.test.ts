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

import { describe, it, expect } from 'vitest';
import { isKnockoutStage, matchRoundLabel, roundNameLabel, stageLabel } from './stage-label';

// `t` de mentira: devuelve la clave (con variables), así se comprueba qué
// clave se pide sin depender del diccionario de ningún idioma. El test con
// el diccionario real de `es` vive en la web (`stage-label.test.ts`).
const t = (key: string, vars?: Record<string, string | number>) =>
  vars ? `${key}:${Object.values(vars).join(',')}` : key;

describe('stage-label', () => {
  it('isKnockoutStage reconoce las fases y rechaza el resto', () => {
    expect(isKnockoutStage('semis')).toBe(true);
    expect(isKnockoutStage('placement')).toBe(true);
    expect(isKnockoutStage('regular')).toBe(false);
    expect(isKnockoutStage(null)).toBe(false);
  });

  it('stageLabel pide la clave de la fase y `placement` no tiene nombre genérico', () => {
    expect(stageLabel('quarters', t)).toBe('playoffs.stage_quarters');
    expect(stageLabel('semis', t)).toBe('playoffs.stage_semis');
    expect(stageLabel('semis', t, true)).toBe('playoffs.stage_semi_one');
    expect(stageLabel('placement', t)).toBeNull();
  });

  it('roundNameLabel deja intacto un nombre propio', () => {
    expect(roundNameLabel('Copa Presidenta', t)).toBe('Copa Presidenta');
    expect(roundNameLabel(null, t)).toBeNull();
  });

  it('matchRoundLabel sin ronda devuelve null', () => {
    expect(matchRoundLabel(null, t)).toBeNull();
  });
});

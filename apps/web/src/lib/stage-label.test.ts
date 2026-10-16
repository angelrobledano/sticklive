import { describe, it, expect } from 'vitest';
import es from '@/locales/es.json';
import { matchRoundLabel, stageLabel, type MatchRoundInfo } from './stage-label';

/** `t` real sobre el diccionario de `es`: una clave que falte se ve aquí. */
function t(key: string, vars?: Record<string, string | number>): string {
  const v = key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], es);
  if (typeof v !== 'string') return key;
  return v.replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? `{${k}}`));
}

const round = (over: Partial<MatchRoundInfo>): MatchRoundInfo => ({
  name: null, number: null, type: null, stage: null, groupName: null, seriesGame: null, phaseKind: null, ...over,
});

describe('stageLabel', () => {
  it('ronda entera vs partido concreto', () => {
    expect(stageLabel('semis', t)).toBe('Semifinales');
    expect(stageLabel('semis', t, true)).toBe('Semifinal');
    expect(stageLabel('quarters', t)).toBe('Cuartos de final');
    expect(stageLabel('final', t)).toBe('Final');
    expect(stageLabel('third_place', t)).toBe('3.er y 4.º puesto');
    expect(stageLabel('round_of_16', t)).toBe('Octavos de final');
  });

  it('colocación no tiene nombre genérico', () => {
    expect(stageLabel('placement', t)).toBeNull();
  });
});

describe('matchRoundLabel — la fase en la ficha del partido', () => {
  it('semifinal a partido único (Mundial)', () => {
    expect(matchRoundLabel(round({ type: 'playoff', stage: 'semis', name: 'Semifinal', phaseKind: 'knockout' }), t)).toBe('Semifinal');
  });

  it('final y 3.º y 4.º', () => {
    expect(matchRoundLabel(round({ type: 'playoff', stage: 'final' }), t)).toBe('Final');
    expect(matchRoundLabel(round({ type: 'playoff', stage: 'third_place' }), t)).toBe('3.er y 4.º puesto');
  });

  it('serie al mejor de N (OK Liga): fase y número de partido', () => {
    expect(matchRoundLabel(round({ type: 'playoff', stage: 'quarters', seriesGame: 2 }), t)).toBe('Cuartos de final · Partido 2');
  });

  it('colocación: el nombre de la fuente', () => {
    expect(matchRoundLabel(round({ type: 'playoff', stage: 'placement', name: 'Puestos 5º-8º' }), t)).toBe('Puestos 5º-8º');
  });

  it('fase de grupos: fase, grupo y jornada', () => {
    expect(matchRoundLabel(round({ type: 'regular', number: 2, groupName: 'A', phaseKind: 'groups' }), t))
      .toBe('Fase de grupos · Grupo A · Jornada 2');
  });

  it('liga: solo la jornada', () => {
    expect(matchRoundLabel(round({ type: 'regular', number: 12, phaseKind: 'league' }), t)).toBe('Jornada 12');
  });

  it('sin stage (heredado o copa): nombre de la ronda, sin deducir nada', () => {
    expect(matchRoundLabel(round({ type: 'playoff', name: 'Cuartos de final' }), t)).toBe('Cuartos de final');
    expect(matchRoundLabel(round({ type: 'cup', name: null }), t)).toBeNull();
  });

  it('sin ronda: nada', () => {
    expect(matchRoundLabel(null, t)).toBeNull();
  });
});

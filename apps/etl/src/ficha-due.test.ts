import { describe, it, expect } from 'vitest';
import { fichaDue, fichaSignature, FICHA_SAFETY_MS } from './ficha-due.js';

const m = (o: Partial<{ status: string; home_score: number | null; away_score: number | null; live_is_halftime: boolean }> = {}) =>
  ({ status: 'live', home_score: 1, away_score: 0, live_is_halftime: false, ...o });

describe('cuándo pedir el acta', () => {
  it('la primera vez, siempre', () => {
    expect(fichaDue(m(), undefined, 0)).toBe(true);
  });
  it('sin cambios en el feed: solo con la red de seguridad de 5 min', () => {
    const prev = { at: 0, sig: fichaSignature(m()) };
    expect(fichaDue(m(), prev, 60_000)).toBe(false);
    expect(fichaDue(m(), prev, FICHA_SAFETY_MS)).toBe(true);
  });
  it('gol, descanso o final: al momento', () => {
    const prev = { at: 0, sig: fichaSignature(m()) };
    expect(fichaDue(m({ home_score: 2 }), prev, 10_000)).toBe(true);
    expect(fichaDue(m({ live_is_halftime: true }), prev, 10_000)).toBe(true);
    expect(fichaDue(m({ status: 'finished' }), prev, 10_000)).toBe(true);
  });
});

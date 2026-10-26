import { describe, it, expect } from 'vitest';
import { learnActaMode, shouldFetchFicha, ACTA_POST_STRIKES } from './acta-mode.js';

/**
 * Actas de base (#417): muchas competiciones solo publican el acta al acabar.
 * Se aprende por competición y se deja de pedir la ficha cada minuto.
 */
describe('learnActaMode', () => {
  const live = { status: 'live', goals: 3 };
  it(`marca «solo al final» tras ${ACTA_POST_STRIKES} directos con goles y ficha vacía`, () => {
    let st = { mode: null as 'live' | 'post' | null, strikes: 0 };
    for (let i = 0; i < ACTA_POST_STRIKES - 1; i++) st = learnActaMode(st, { ...live, events: 0 });
    expect(st.mode).toBeNull();
    st = learnActaMode(st, { ...live, events: 0 });
    expect(st.mode).toBe('post');
  });
  it('un directo con eventos lo desmarca y reinicia', () => {
    expect(learnActaMode({ mode: 'post', strikes: 5 }, { ...live, events: 2 })).toEqual({ mode: 'live', strikes: 0 });
  });
  it('no aprende de un 0-0 ni de partidos que no están en directo', () => {
    const st = { mode: null, strikes: 1 } as const;
    expect(learnActaMode(st, { status: 'live', goals: 0, events: 0 })).toEqual(st);
    expect(learnActaMode(st, { status: 'finished', goals: 4, events: 0 })).toEqual(st);
  });
});

describe('shouldFetchFicha', () => {
  const now = new Date('2026-10-26T12:00:00Z');
  const ago = (min: number) => new Date(now.getTime() - min * 60_000);
  it('directo de competición normal: siempre', () => {
    expect(shouldFetchFicha({ status: 'live', mode: null, fetchedAt: ago(1), emptyChecks: 0 }, now)).toBe(true);
  });
  it('directo de competición «solo al final»: cada 15 min como latido', () => {
    expect(shouldFetchFicha({ status: 'live', mode: 'post', fetchedAt: ago(5), emptyChecks: 0 }, now)).toBe(false);
    expect(shouldFetchFicha({ status: 'live', mode: 'post', fetchedAt: ago(15), emptyChecks: 0 }, now)).toBe(true);
    expect(shouldFetchFicha({ status: 'live', mode: 'post', fetchedAt: null, emptyChecks: 0 }, now)).toBe(true);
  });
  it('terminado sin acta: los primeros intentos seguidos, luego cada 15 min, y se rinde', () => {
    expect(shouldFetchFicha({ status: 'finished', mode: null, fetchedAt: ago(1), emptyChecks: 2 }, now)).toBe(true);
    expect(shouldFetchFicha({ status: 'finished', mode: null, fetchedAt: ago(5), emptyChecks: 3 }, now)).toBe(false);
    expect(shouldFetchFicha({ status: 'finished', mode: null, fetchedAt: ago(15), emptyChecks: 3 }, now)).toBe(true);
    expect(shouldFetchFicha({ status: 'finished', mode: null, fetchedAt: ago(60), emptyChecks: 12 }, now)).toBe(false);
  });
});

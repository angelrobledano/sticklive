import { describe, it, expect } from 'vitest';
import { MissingLiveTracker } from './missing-live.js';

/**
 * #374: un `live` con marcador que desaparece del feed mc N ciclos seguidos es
 * casi seguro un final. La decisión es pura y testeable: el tracker sólo cuenta
 * ausencias consecutivas y decide cuándo finalizar.
 */
describe('MissingLiveTracker', () => {
  it('no finaliza mientras el partido sigue en el feed', () => {
    const t = new MissingLiveTracker(3);
    const refs = ['fep_match_1'];
    expect(t.observe(refs, new Set(['fep_match_1']))).toEqual([]);
    expect(t.observe(refs, new Set(['fep_match_1']))).toEqual([]);
  });

  it('finaliza tras N ciclos consecutivos ausente', () => {
    const t = new MissingLiveTracker(3);
    const refs = ['fep_match_1'];
    const seen = new Set<string>();
    expect(t.observe(refs, seen)).toEqual([]); // 1
    expect(t.observe(refs, seen)).toEqual([]); // 2
    expect(t.observe(refs, seen)).toEqual(['fep_match_1']); // 3 → finalizar
  });

  it('una reaparición resetea la cuenta de ausencias', () => {
    const t = new MissingLiveTracker(3);
    const refs = ['fep_match_1'];
    t.observe(refs, new Set()); // 1
    t.observe(refs, new Set()); // 2
    t.observe(refs, new Set(['fep_match_1'])); // vuelve → reset
    expect(t.observe(refs, new Set())).toEqual([]); // 1 de nuevo
    expect(t.observe(refs, new Set())).toEqual([]); // 2
    expect(t.observe(refs, new Set())).toEqual(['fep_match_1']); // 3
  });

  it('sólo dispara una vez por partido (el resto las ve el ETL ya finished)', () => {
    const t = new MissingLiveTracker(2);
    const refs = ['fep_match_1'];
    expect(t.observe(refs, new Set())).toEqual([]); // 1
    expect(t.observe(refs, new Set())).toEqual(['fep_match_1']); // 2
    expect(t.observe(refs, new Set())).toEqual([]); // ya no se repite
  });

  it('gestiona varios partidos a la vez con cuentas independientes', () => {
    const t = new MissingLiveTracker(2);
    const refs = ['a', 'b'];
    expect(t.observe(refs, new Set(['a']))).toEqual([]); // a visto, b=1
    expect(t.observe(refs, new Set(['a']))).toEqual(['b']); // b=2
  });

  it('umbral 1 finaliza a la primera ausencia (caso extremo configurable)', () => {
    const t = new MissingLiveTracker(1);
    expect(t.observe(['a'], new Set())).toEqual(['a']);
  });
});

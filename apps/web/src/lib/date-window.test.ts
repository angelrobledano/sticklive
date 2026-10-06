import { describe, it, expect } from 'vitest';
import { computeDateWindow } from './date-window';

/** 15 días de kalendario: 2026-10-01 .. 2026-10-15 */
const KEYS = Array.from({ length: 15 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`);

describe('computeDateWindow (ventana de 7 días del selector en escritorio)', () => {
  it('centra el día seleccionado cuando hay margen', () => {
    const w = computeDateWindow(KEYS, '2026-10-06');
    expect(w.keys).toHaveLength(7);
    expect(w.keys[3]).toBe('2026-10-06'); // centro = seleccionado
    expect(w.canPrev).toBe(true);
    expect(w.canNext).toBe(true);
  });

  it('se clastra en los bordes de la lista (no sale de rango)', () => {
    const first = computeDateWindow(KEYS, '2026-10-01');
    expect(first.keys[0]).toBe('2026-10-01');
    expect(first.canPrev).toBe(false);
    const last = computeDateWindow(KEYS, '2026-10-15');
    expect(last.keys[6]).toBe('2026-10-15');
    expect(last.canNext).toBe(false);
  });

  it('las flechas pagan la ventana de 7 en 7, clastrapos', () => {
    const base = computeDateWindow(KEYS, '2026-10-04'); // ventana 10-01..10-07
    expect(base.canPrev).toBe(false);
    const next = computeDateWindow(KEYS, '2026-10-04', base.start + 7);
    expect(next.keys[0]).toBe('2026-10-08');
    expect(next.keys[6]).toBe('2026-10-14');
    expect(next.canNext).toBe(true);
    const last = computeDateWindow(KEYS, '2026-10-04', next.start + 7);
    expect(last.keys[6]).toBe('2026-10-15'); // clastrado al final
    expect(last.canNext).toBe(false);
    const back = computeDateWindow(KEYS, '2026-10-04', last.start - 14);
    expect(back.keys[0]).toBe('2026-10-01');
    expect(back.canPrev).toBe(false);
  });

  it('listas más cortas que la ventana: un solo bloque, sin flechas', () => {
    const w = computeDateWindow(KEYS.slice(0, 4), '2026-10-03');
    expect(w.keys).toHaveLength(4);
    expect(w.canPrev).toBe(false);
    expect(w.canNext).toBe(false);
  });
});

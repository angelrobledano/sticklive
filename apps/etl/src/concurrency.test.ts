import { describe, it, expect } from 'vitest';
import { forEachLimited } from './concurrency.js';

describe('forEachLimited', () => {
  it('procesa todos los elementos', async () => {
    const seen: number[] = [];
    await forEachLimited([1, 2, 3, 4, 5], 2, async (n) => { seen.push(n); });
    expect(seen.slice().sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it('nunca supera el límite de concurrencia, pero sí paraleliza', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    await forEachLimited(Array.from({ length: 12 }, (_, i) => i), 3, async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
    });
    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(maxInFlight).toBeGreaterThan(1);
  });

  it('lista vacía no invoca fn', async () => {
    let called = 0;
    await forEachLimited([], 4, async () => { called++; });
    expect(called).toBe(0);
  });

  it('un límite mayor que la lista funciona igual', async () => {
    const seen: number[] = [];
    await forEachLimited([1, 2], 10, async (n) => { seen.push(n); });
    expect(seen.slice().sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it('pasa el índice correcto', async () => {
    const pares: Array<[number, number]> = [];
    await forEachLimited(['a', 'b', 'c'], 1, async (v, i) => { pares.push([i, v.charCodeAt(0)]); });
    expect(pares).toEqual([[0, 97], [1, 98], [2, 99]]);
  });
});

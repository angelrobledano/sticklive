import { describe, it, expect } from 'vitest';
import { isChunkLoadError, shouldAutoReload } from './chunk-error';

/** Tras un despliegue, el HTML cacheado puede pedir chunks que ya no existen. */
describe('chunk-error', () => {
  it('reconoce los errores de carga de chunks', () => {
    expect(isChunkLoadError(new Error('Loading chunk 1972 failed.'))).toBe(true);
    expect(isChunkLoadError(Object.assign(new Error('x'), { name: 'ChunkLoadError' }))).toBe(true);
    expect(isChunkLoadError(new Error('Failed to fetch dynamically imported module: /a.js'))).toBe(true);
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
  });
  it('recarga una sola vez por minuto', () => {
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); } };
    expect(shouldAutoReload(store, 1_000)).toBe(true);
    expect(shouldAutoReload(store, 30_000)).toBe(false);
    expect(shouldAutoReload(store, 70_000)).toBe(true);
  });
  it('sin almacenamiento no recarga (evita bucles)', () => {
    const broken = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
    expect(shouldAutoReload(broken, 1_000)).toBe(false);
  });
});

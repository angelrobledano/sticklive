import { describe, it, expect } from 'vitest';
import { SidgadGuard, BLOCK_BASE_MS, BLOCK_MAX_MS, MIN_GAP_MS } from './sidgad-guard.js';

describe('freno de sidgad', () => {
  it('pausa creciente con cada bloqueo, con tope, y se borra con una respuesta buena', () => {
    let t = 0;
    const g = new SidgadGuard(() => t);
    expect(g.remaining('h')).toBe(0);
    expect(g.blocked('h')).toBe(BLOCK_BASE_MS);
    expect(g.remaining('h')).toBe(BLOCK_BASE_MS);
    expect(g.blocked('h')).toBe(BLOCK_BASE_MS * 2);
    for (let i = 0; i < 5; i++) g.blocked('h');
    expect(g.remaining('h')).toBe(BLOCK_MAX_MS);
    t += BLOCK_MAX_MS;
    expect(g.remaining('h')).toBe(0);
    g.ok('h');
    expect(g.blocked('h')).toBe(BLOCK_BASE_MS);
  });

  it('separa las peticiones al mismo host, no a hosts distintos', () => {
    const t = 1000;
    const g = new SidgadGuard(() => t);
    expect(g.reserve('a')).toBe(0);
    expect(g.reserve('a')).toBe(MIN_GAP_MS);
    expect(g.reserve('a')).toBe(2 * MIN_GAP_MS);
    expect(g.reserve('b')).toBe(0);
  });
});

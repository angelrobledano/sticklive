import { describe, it, expect } from 'vitest';
import { setBounded } from './bounded-cache.js';

describe('setBounded (#333)', () => {
  it('guarda normalmente por debajo del tope', () => {
    const m = new Map<string, number>();
    setBounded(m, 'a', 1, 3);
    setBounded(m, 'b', 2, 3);
    expect(m.size).toBe(2);
    expect(m.get('a')).toBe(1);
  });

  it('evicta el más antiguo al superar el tope', () => {
    const m = new Map<string, number>();
    setBounded(m, 'a', 1, 2);
    setBounded(m, 'b', 2, 2);
    setBounded(m, 'c', 3, 2);
    expect(m.size).toBe(2);
    expect(m.has('a')).toBe(false);
    expect(m.get('c')).toBe(3);
  });

  it('reescribir una clave la renueva (no cuenta doble)', () => {
    const m = new Map<string, number>();
    setBounded(m, 'a', 1, 2);
    setBounded(m, 'b', 2, 2);
    setBounded(m, 'a', 10, 2); // 'a' pasa al final
    setBounded(m, 'c', 3, 2);  // debe evictar 'b', no 'a'
    expect(m.get('a')).toBe(10);
    expect(m.has('b')).toBe(false);
  });

  it('nunca deja el mapa vacío por debajo del tope', () => {
    const m = new Map<string, number>();
    setBounded(m, 'a', 1, 0); // tope inválido → se trata como 1
    expect(m.size).toBe(1);
  });
});

import { describe, it, expect } from 'vitest';
import { maxTempIdByKey } from './current-temps.js';

describe('maxTempIdByKey', () => {
  it('elige el tempId máximo por clave (la temporada vigente)', () => {
    const m = maxTempIdByKey([
      { key: 'ok-liga-masculina', tempId: '38' },
      { key: 'ok-liga-masculina', tempId: '40' },
      { key: 'ok-liga-masculina', tempId: '39' },
    ]);
    expect(m.get('ok-liga-masculina')).toBe('40');
  });

  it('compara numéricamente, no como texto', () => {
    const m = maxTempIdByKey([{ key: 'k', tempId: '9' }, { key: 'k', tempId: '10' }]);
    expect(m.get('k')).toBe('10');
  });

  it('ignora tempIds nulos, vacíos o no numéricos', () => {
    const m = maxTempIdByKey([
      { key: 'k', tempId: null },
      { key: 'k', tempId: '' },
      { key: 'k', tempId: 'abc' },
      { key: 'k', tempId: '5' },
    ]);
    expect(m.get('k')).toBe('5');
  });

  it('cada clave es independiente', () => {
    const m = maxTempIdByKey([{ key: 'a', tempId: '1' }, { key: 'b', tempId: '99' }]);
    expect(m.get('a')).toBe('1');
    expect(m.get('b')).toBe('99');
    expect(m.get('c')).toBeUndefined();
  });
});

import { describe, it, expect } from 'vitest';
import { visibleCompColumns } from './PlayerProfileClient';

describe('visibleCompColumns', () => {
  const r = (blueCards = 0, redCards = 0, penaltiesTotal = 0) => ({ blueCards, redCards, penaltiesTotal });
  it('sin tarjetas ni penaltis: solo PJ y G', () => {
    expect(visibleCompColumns([r(), r()])).toEqual(['pj', 'goals']);
  });
  it('una columna sale si alguna fila tiene dato', () => {
    expect(visibleCompColumns([r(), r(1, 0, 2)])).toEqual(['pj', 'goals', 'az', 'pe']);
  });
});

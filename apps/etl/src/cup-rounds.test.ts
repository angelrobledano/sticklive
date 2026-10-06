import { describe, it, expect } from 'vitest';
import { cupRoundNumber, finalFourRoundNumber, regularRoundNumber } from './cup-rounds.js';

describe('cupRoundNumber — bracket genérico', () => {
  it('ordena las fases de una copa', () => {
    expect(cupRoundNumber('Octavos de final')).toBe(1);
    expect(cupRoundNumber('1/8')).toBe(1);
    expect(cupRoundNumber('Cuartos')).toBe(2);
    expect(cupRoundNumber('Semifinales')).toBe(3);
    expect(cupRoundNumber('Final')).toBe(4);
    expect(cupRoundNumber('Tercer y cuarto puesto')).toBe(5);
    expect(cupRoundNumber('Ronda rara')).toBe(9);
  });
});

describe('finalFourRoundNumber — Semifinal(1) → Final(2)', () => {
  it('no confunde "Semifinal" con la final (contiene "final")', () => {
    expect(finalFourRoundNumber('SEMIFINALES')).toBe(1);
    expect(finalFourRoundNumber('Semifinal 1')).toBe(1);
    expect(finalFourRoundNumber('FINAL')).toBe(2);
  });

  it('coloca el 3º-4º puesto al final', () => {
    expect(finalFourRoundNumber('3º-4º puesto')).toBe(3);
    expect(finalFourRoundNumber('Tercer puesto')).toBe(3);
  });
});

describe('regularRoundNumber — jornada de liga', () => {
  it('extrae el número de "JORNADA N"', () => {
    expect(regularRoundNumber('JORNADA 1')).toBe(1);
    expect(regularRoundNumber('Jornada 26')).toBe(26);
  });

  it('sin dígitos devuelve null (ronda descartada)', () => {
    expect(regularRoundNumber('Cuartos')).toBeNull();
    expect(regularRoundNumber('')).toBeNull();
  });
});

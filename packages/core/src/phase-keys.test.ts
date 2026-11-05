import { describe, it, expect } from 'vitest';
import { madridDay, matchPhaseKey, playoffPhaseKey } from './phase-keys';

describe('playoffPhaseKey', () => {
  it('reconoce las fases por el nombre, en español y en inglés', () => {
    expect(playoffPhaseKey('Cuartos de final', null)).toBe('quarters');
    expect(playoffPhaseKey('Quarterfinals', null)).toBe('quarters');
    expect(playoffPhaseKey('Semifinal', null)).toBe('semis');
    expect(playoffPhaseKey('Final', null)).toBe('final');
    expect(playoffPhaseKey('3º y 4º puesto', null)).toBe('third_place');
  });

  it('cae al número de ronda si el nombre no da pista (igual que groupByPhase)', () => {
    expect(playoffPhaseKey(null, 1)).toBe('quarters');
    expect(playoffPhaseKey(null, 2)).toBe('semis');
    expect(playoffPhaseKey(null, 3)).toBe('final');
  });

  it('devuelve null para un nombre propio no traducible', () => {
    // "Final" NO debe colar aquí: se comprueba una copa con nombre propio.
    expect(playoffPhaseKey('Copa del Rey', null)).toBeNull();
    expect(playoffPhaseKey('Supercopa', null)).toBeNull();
  });

  it('el orden de las reglas evita que "Semifinal" caiga en "final"', () => {
    // "Semifinal" contiene "final"; la regla de semi va antes.
    expect(playoffPhaseKey('Semifinal 1', null)).toBe('semis');
  });

  it('reconoce octavos y NO los confunde con la final', () => {
    // "Octavos de final" contiene "final": antes se clasificaba como 'final'.
    expect(playoffPhaseKey('Octavos de final', null)).toBe('round_of_16');
    expect(playoffPhaseKey('Round of 16', null)).toBe('round_of_16');
    expect(playoffPhaseKey('1/8 de final', null)).toBe('round_of_16');
    // Y la gran final sigue siendo la final.
    expect(playoffPhaseKey('Final', null)).toBe('final');
  });
});

describe('playoffPhaseKey (casos de la app)', () => {
  it('combina nombre y número de ronda', () => {
    expect(playoffPhaseKey('Cuartos de final', 1)).toBe('quarters');
    expect(playoffPhaseKey('Semifinales', 2)).toBe('semis');
    expect(playoffPhaseKey('Final', 3)).toBe('final');
    expect(playoffPhaseKey('Octavos', null)).toBe('round_of_16');
  });
});

describe('matchPhaseKey', () => {
  it('la fase explícita (`stage`) manda sobre el nombre y el número', () => {
    expect(matchPhaseKey({ stage: 'semis', roundName: 'Final', roundNumber: 3 })).toBe('semis');
  });

  it('`placement` no es una fase del cuadro por el título', () => {
    expect(matchPhaseKey({ stage: 'placement', roundName: 'Puestos 5º-8º' })).toBeNull();
  });

  it('sin `stage` deduce del nombre y, si no, del número', () => {
    expect(matchPhaseKey({ roundName: 'Cuartos de final' })).toBe('quarters');
    expect(matchPhaseKey({ roundNumber: 2 })).toBe('semis');
    expect(matchPhaseKey({})).toBeNull();
  });
});

describe('madridDay', () => {
  it('devuelve null con una fecha inválida en vez de lanzar RangeError', () => {
    expect(madridDay('no-es-fecha')).toBeNull();
    expect(madridDay('2026-13-45T99:00:00Z', 'Europe/Lisbon')).toBeNull();
  });

  it('devuelve la clave de día en Madrid por defecto', () => {
    // 23:30 UTC del 20 jun es ya 21 jun en Madrid (verano, UTC+2).
    expect(madridDay('2026-06-20T23:30:00Z')).toBe('2026-06-21');
  });

  it('respeta la zona de la competición', () => {
    expect(madridDay('2026-06-20T23:30:00Z', 'Europe/Lisbon')).toBe('2026-06-21');
    expect(madridDay('2026-06-20T22:30:00Z', 'Europe/Lisbon')).toBe('2026-06-20');
  });

  it('sin instante devuelve null', () => {
    expect(madridDay(null)).toBeNull();
  });
});

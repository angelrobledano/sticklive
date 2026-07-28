import { describe, it, expect } from 'vitest';
import { roundLabel, playoffPhaseKey, playoffPhaseLabel } from './format';
import type { SeasonRound } from '@/lib/api/client';

/**
 * `t` de mentira que imita el real: sustituye {n} y, si no conoce la clave,
 * devuelve la clave (como hace el fallback de i18n.tsx). Así el test comprueba
 * que se usa la CLAVE correcta, no una cadena traducida a mano.
 */
function fakeT(key: string, vars?: Record<string, string | number>): string {
  const plantillas: Record<string, string> = { 'fixtures.matchday': 'Matchday {n}' };
  let s = plantillas[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

function ronda(over: Partial<SeasonRound> = {}): SeasonRound {
  return { id: 'r1', number: 5, name: null, roundType: 'regular', ...over };
}

describe('roundLabel', () => {
  it('las jornadas regulares se traducen desde el número, no desde name', () => {
    // El name en la base está en español ("Jornada 5"); debe IGNORARSE.
    const r = ronda({ number: 5, name: 'Jornada 5', roundType: 'regular' });
    expect(roundLabel(r, fakeT)).toBe('Matchday 5');
  });

  it('usa la clave fixtures.matchday (no una cadena fija)', () => {
    // Con un `t` que no conoce la clave, cae a la clave: prueba que la usa.
    const r = ronda({ number: 3, roundType: 'regular' });
    const t = (k: string) => k;
    expect(roundLabel(r, t)).toBe('fixtures.matchday');
  });

  it('el playoff conserva su nombre propio (Fase B lo traducirá)', () => {
    const r = ronda({ number: 100, name: 'Cuartos de final', roundType: 'playoff' });
    expect(roundLabel(r, fakeT)).toBe('Playoffs · Cuartos de final');
  });

  it('playoff sin nombre cae al número', () => {
    const r = ronda({ number: 101, name: null, roundType: 'playoff' });
    expect(roundLabel(r, fakeT)).toBe('Playoffs 101');
  });
});

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

describe('playoffPhaseLabel', () => {
  it('traduce la fase conocida', () => {
    const t = (k: string) => (k === 'playoffs.quarters' ? 'Quarters' : k);
    expect(playoffPhaseLabel('Cuartos de final', null, t)).toBe('Quarters');
  });

  it('conserva el nombre propio cuando no es una fase estándar', () => {
    const t = (k: string) => k;
    expect(playoffPhaseLabel('Copa del Rey', null, t)).toBe('Copa del Rey');
  });
});

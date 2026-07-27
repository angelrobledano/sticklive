import { describe, it, expect } from 'vitest';
import { roundLabel } from './format';
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

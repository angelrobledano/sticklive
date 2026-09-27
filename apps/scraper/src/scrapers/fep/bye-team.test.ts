import { describe, it, expect } from 'vitest';
import { isByeTeamName } from './bye-team.js';

describe('isByeTeamName', () => {
  it('reconoce el pseudo-equipo DESCANSO (la fila de bye de Bronce N/S)', () => {
    expect(isByeTeamName('DESCANSO')).toBe(true);
    expect(isByeTeamName('Descanso')).toBe(true);
    expect(isByeTeamName('  descanso  ')).toBe(true);
  });

  it('no confunde equipos reales con el bye', () => {
    expect(isByeTeamName('CLUB HOCKEY OLEIROS')).toBe(false);
    expect(isByeTeamName('DESCANSO FEMENINO')).toBe(false); // no es el pseudo-equipo exacto
    expect(isByeTeamName('')).toBe(false);
    expect(isByeTeamName(null)).toBe(false);
    expect(isByeTeamName(undefined)).toBe(false);
  });
});

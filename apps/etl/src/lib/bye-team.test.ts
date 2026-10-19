import { describe, it, expect } from 'vitest';
import { isByeTeamName } from './bye-team.js';

describe('isByeTeamName', () => {
  it('reconoce el pseudo-equipo de descanso con o sin número', () => {
    expect(isByeTeamName('DESCANSO')).toBe(true);
    expect(isByeTeamName('DESCANSO 1')).toBe(true);
    expect(isByeTeamName(' descanso 12 ')).toBe(true);
  });

  it('no confunde equipos reales', () => {
    expect(isByeTeamName('CLUB DESCANSO')).toBe(false);
    expect(isByeTeamName('DESCANSO F.C.')).toBe(false);
    expect(isByeTeamName('')).toBe(false);
  });
});

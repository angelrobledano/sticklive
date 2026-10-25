import { describe, it, expect } from 'vitest';
import { collapseRepeatedTeamLetter } from './team-name.js';

/**
 * FECAPA (base) publica a veces la letra del equipo duplicada: «CLUB PATI
 * CUBELLES B B», «RIBES CP A A». Con la letra doble el nombre no casa con nada.
 */
describe('collapseRepeatedTeamLetter', () => {
  it.each([
    ['CLUB PATI CUBELLES B B', 'CLUB PATI CUBELLES B'],
    ['FUTBOL CLUB MARTINENC C C', 'FUTBOL CLUB MARTINENC C'],
    ['RIBES CP A A', 'RIBES CP A'],
    ["TÀRREGA HOQUEI PATINS CLUB C C", "TÀRREGA HOQUEI PATINS CLUB C"],
    ['CLUB PATÍ VILAFRANCA AKO D  D ', 'CLUB PATÍ VILAFRANCA AKO D'],
  ])('%s → %s', (raw, clean) => {
    expect(collapseRepeatedTeamLetter(raw)).toBe(clean);
  });

  it.each(['CP VIC B', 'CLUB PATI CUBELLES A B', 'HC SANT JUST', 'GEIEG', 'CP A'])('no toca %s', (n) => {
    expect(collapseRepeatedTeamLetter(n)).toBe(n);
  });
});

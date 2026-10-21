import { describe, expect, it } from 'vitest';
import { clubName, teamDisplayName, playerDisplayName } from './names';

describe('names utility', () => {
  it('normalizes uppercase club names to sentence/title case with acronyms preserved', () => {
    expect(clubName('IGUALADA RIGAT HC')).toBe('Igualada Rigat HC');
    expect(clubName('C.E. NOIA FREIXENET')).toBe('CE Noia Freixenet');
    expect(clubName('C. P. SAN CRISTOBAL')).toBe('CP San Cristobal');
    expect(clubName('CLUB PATI VIC')).toBe('Club Pati Vic');
  });

  it('keeps connectors in lowercase', () => {
    expect(clubName('COPA DEL REY')).toBe('Copa del Rey');
  });

  it('prefers full name over cryptic shortName', () => {
    expect(teamDisplayName('CLUB PATIN ALCOBENDAS', 'CPA')).toBe('Club Patin Alcobendas');
    expect(teamDisplayName('', 'CPA')).toBe('CPA');
    expect(teamDisplayName(null, 'CEV')).toBe('CEV');
  });

  it('formats player display names cleanly', () => {
    expect(playerDisplayName('POL', 'CABRE ARMENGOL')).toBe('Pol Cabre');
    expect(playerDisplayName('CARLO', 'DI BENEDETTO')).toBe('Carlo Di Benedetto');
  });
});

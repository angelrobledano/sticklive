import { describe, it, expect } from 'vitest';
import { pickRefOwnerForPortal, ownedByOtherPortal } from './seed-ref-portal.js';

const lodi = { teamId: 'lodi', competitionSourceRef: 'fisr_competition_5001' };
const oleiros = { teamId: 'oleiros', competitionSourceRef: 'fgp_competition_4853934' };
const rfep = { teamId: 'noia', competitionSourceRef: '3568' };

describe('pickRefOwnerForPortal', () => {
  it('ignora al dueño de otro portal', () => {
    expect(pickRefOwnerForPortal([lodi], 'fgp')).toBeNull();
  });
  it('se queda con el del mismo portal aunque haya colisión', () => {
    expect(pickRefOwnerForPortal([lodi, oleiros], 'fgp')).toEqual({ teamId: 'oleiros' });
  });
  it('una competición sin prefijo es RFEP', () => {
    expect(pickRefOwnerForPortal([rfep, lodi], 'fep')).toEqual({ teamId: 'noia' });
  });
  it('dos equipos distintos del mismo portal con la ref → ambiguo', () => {
    const otro = { teamId: 'x', competitionSourceRef: 'fgp_competition_1' };
    expect(pickRefOwnerForPortal([oleiros, otro], 'fgp')).toEqual({ ambiguous: ['oleiros', 'x'] });
  });
  it('el mismo equipo en varias temporadas no es ambiguo', () => {
    const otraTemp = { teamId: 'oleiros', competitionSourceRef: 'fgp_competition_9' };
    expect(pickRefOwnerForPortal([oleiros, otraTemp], 'fgp')).toEqual({ teamId: 'oleiros' });
  });
});

describe('ownedByOtherPortal', () => {
  it('detecta un dueño de otro portal', () => {
    expect(ownedByOtherPortal([lodi], 'fgp')).toBe(true);
    expect(ownedByOtherPortal([oleiros], 'fgp')).toBe(false);
    expect(ownedByOtherPortal([], 'fgp')).toBe(false);
  });
});

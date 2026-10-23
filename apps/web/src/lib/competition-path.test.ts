import { describe, it, expect } from 'vitest';
import { competitionPath, competitionKey, isCompetitionSlug } from './competition-path';

const ID = 'ac2ef132-1234-4abc-8def-0123456789ab';

describe('competitionPath', () => {
  it('usa el slug cuando es válido', () => {
    expect(competitionPath(ID, 'ok-liga-masculina')).toBe('/competitions/ok-liga-masculina');
  });

  it('cae al id si no hay slug o no es válido', () => {
    expect(competitionPath(ID)).toBe(`/competitions/${ID}`);
    expect(competitionPath(ID, null)).toBe(`/competitions/${ID}`);
    expect(competitionPath(ID, 'OK Liga')).toBe(`/competitions/${ID}`);
    expect(competitionPath(ID, ID)).toBe(`/competitions/${ID}`);
  });

  it('añade la temporada como ?season=', () => {
    expect(competitionPath(ID, 'ok-liga', 's1')).toBe('/competitions/ok-liga?season=s1');
  });
});

describe('competitionKey / isCompetitionSlug', () => {
  it('distingue slug de UUID', () => {
    expect(isCompetitionSlug('copa-del-rey')).toBe(true);
    expect(isCompetitionSlug(ID)).toBe(false);
    expect(competitionKey(ID, 'copa-del-rey')).toBe('copa-del-rey');
  });
});

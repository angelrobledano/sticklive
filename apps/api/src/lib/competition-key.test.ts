import { describe, it, expect } from 'vitest';
import { parseCompetitionKey, isCompetitionSlug } from './competition-key.js';

describe('parseCompetitionKey', () => {
  it('reconoce un UUID como id', () => {
    const id = 'ac2ef132-1234-4abc-8def-0123456789ab';
    expect(parseCompetitionKey(id)).toEqual({ by: 'id', value: id });
  });

  it('reconoce un slug bien formado', () => {
    expect(parseCompetitionKey('ok-liga-masculina')).toEqual({ by: 'slug', value: 'ok-liga-masculina' });
    expect(parseCompetitionKey('copa-del-rey-2')).toEqual({ by: 'slug', value: 'copa-del-rey-2' });
  });

  it('rechaza lo que no es ni UUID ni slug', () => {
    for (const bad of ['', 'OK-Liga', 'ok liga', 'ok--liga', '-ok', 'ok-', 'ok_liga', "x';--", 'a'.repeat(121)]) {
      expect(parseCompetitionKey(bad)).toBeNull();
    }
  });
});

describe('isCompetitionSlug', () => {
  it('un UUID no cuenta como slug', () => {
    expect(isCompetitionSlug('ac2ef132-1234-4abc-8def-0123456789ab')).toBe(false);
  });
});

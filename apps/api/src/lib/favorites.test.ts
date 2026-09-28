import { describe, it, expect } from 'vitest';
import { buildFavoritePairs, MAX_FAVORITES_PER_KIND } from './favorites.js';

const U = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;

describe('buildFavoritePairs (#333)', () => {
  it('mapea los tres tipos con su kind', () => {
    const pairs = buildFavoritePairs({ teams: [U(1)], leagues: [U(2)], players: [U(3)] });
    expect(pairs).toEqual([
      { kind: 'team', refId: U(1) },
      { kind: 'league', refId: U(2) },
      { kind: 'player', refId: U(3) },
    ]);
  });

  it('descarta ids que no son UUID (y arrays ausentes)', () => {
    const pairs = buildFavoritePairs({ teams: ['nope', U(1), '123', ''], players: undefined });
    expect(pairs).toEqual([{ kind: 'team', refId: U(1) }]);
  });

  it('acota a MAX_FAVORITES_PER_KIND por tipo', () => {
    const teams = Array.from({ length: MAX_FAVORITES_PER_KIND + 50 }, (_, i) => U(i));
    const pairs = buildFavoritePairs({ teams });
    expect(pairs).toHaveLength(MAX_FAVORITES_PER_KIND);
  });

  it('sin nada devuelve lista vacía', () => {
    expect(buildFavoritePairs({})).toEqual([]);
  });
});

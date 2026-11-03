import { describe, it, expect } from 'vitest';
import { groupFavoriteLeagues, type GroupableLeague } from './favorites-groups';

/** Auditoría UX 03/11/2026 #3: Favoritos era una lista alfabética de ~170 ligas. */
const L = (id: string, o: Partial<GroupableLeague> = {}): GroupableLeague => ({
  id, name: id, country: 'ES', featuredRank: null, tier: null,
  federation: { code: 'RFEP', name: 'RFEP', level: 'national' }, ...o,
});
const FECAPA = { code: 'FECAPA', name: 'Federació Catalana', level: 'regional' as const };

describe('groupFavoriteLeagues', () => {
  const leagues = [
    L('benjami', { federation: FECAPA, tier: 9 }),
    L('okliga', { featuredRank: 1, tier: 1 }),
    L('primera-cat', { federation: FECAPA, tier: 4 }),
    L('placard', { country: 'PT', featuredRank: 2, federation: { code: 'FPP', name: 'FPP', level: 'national' } }),
    L('tercera-pt', { country: 'PT', tier: 3, federation: { code: 'FPP', name: 'FPP', level: 'national' } }),
    L('bronce', { tier: 3 }),
  ];

  it('seguidas arriba, fuera del resto', () => {
    const g = groupFavoriteLeagues(leagues, { followedIds: ['primera-cat'] });
    expect(g.following.map((l) => l.id)).toEqual(['primera-cat']);
    const rest = g.countries.flatMap((c) => c.federations.flatMap((f) => f.leagues.map((l) => l.id)));
    expect(rest).not.toContain('primera-cat');
  });

  it('destacadas por featuredRank y no repetidas en su país', () => {
    const g = groupFavoriteLeagues(leagues, { followedIds: [] });
    expect(g.featured.map((l) => l.id)).toEqual(['okliga', 'placard']);
    expect(g.countries.find((c) => c.country === 'ES')!.federations[0]!.leagues.map((l) => l.id)).toEqual(['bronce']);
  });

  it('por país (el preferido primero) y federación (nacional antes que regional), ligas por importancia', () => {
    const g = groupFavoriteLeagues(leagues, { followedIds: [], country: 'PT' });
    expect(g.countries.map((c) => c.country)).toEqual(['PT', 'ES']);
    const es = g.countries[1]!;
    expect(es.federations.map((f) => f.code)).toEqual(['RFEP', 'FECAPA']);
    expect(es.federations[1]!.leagues.map((l) => l.id)).toEqual(['primera-cat', 'benjami']);
    expect(es.count).toBe(3);
  });
});

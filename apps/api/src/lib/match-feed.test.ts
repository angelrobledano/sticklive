import { describe, it, expect } from 'vitest';
import { parseFeedQuery, applyFeedScope } from './match-feed.js';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';

describe('parseFeedQuery', () => {
  it('sin scope: todo, como siempre (compatible con clientes antiguos)', () => {
    expect(parseFeedQuery({})).toEqual({ scope: 'all', teamIds: [], leagueIds: [], country: null });
  });
  it('lee scope, ids (solo UUID válidos, sin duplicados) y país ISO-2', () => {
    expect(parseFeedQuery({ scope: 'feed', teams: `${U1},x,${U1}`, leagues: U2, country: 'es' }))
      .toEqual({ scope: 'feed', teamIds: [U1], leagueIds: [U2], country: 'ES' });
  });
  it('scope desconocido o país raro: se ignoran', () => {
    expect(parseFeedQuery({ scope: 'otro', country: 'ESP' })).toMatchObject({ scope: 'all', country: null });
  });
  it('tope de 200 ids por lista', () => {
    const many = Array.from({ length: 300 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`).join(',');
    expect(parseFeedQuery({ teams: many }).teamIds).toHaveLength(200);
  });
});

describe('applyFeedScope', () => {
  const m = (id: string, o: Record<string, unknown> = {}) => ({
    id, homeTeam: { id: 'h' }, awayTeam: { id: 'a' }, competitionId: 'c', competitionFeaturedRank: null,
    competitionTier: null, competitionCountry: 'ES', ...o,
  });
  const all = [m('dest', { competitionFeaturedRank: 1 }), m('peq'), m('eq', { homeTeam: { id: U1 } }), m('liga', { competitionId: U2 })];

  it('feed: destacadas + seguidas; el resto se cuenta, no se manda', () => {
    const r = applyFeedScope(all, { scope: 'feed', teamIds: [U1], leagueIds: [U2], country: null });
    expect(r.matches.map((x) => x.id)).toEqual(['dest', 'eq', 'liga']);
    expect(r.hiddenCount).toBe(1);
  });
  it('following: solo lo seguido, sin destacadas', () => {
    const r = applyFeedScope(all, { scope: 'following', teamIds: [U1], leagueIds: [], country: null });
    expect(r.matches.map((x) => x.id)).toEqual(['eq']);
  });
  it('all: sin tocar', () => {
    const r = applyFeedScope(all, { scope: 'all', teamIds: [], leagueIds: [], country: null });
    expect(r.matches).toHaveLength(4);
    expect(r.hiddenCount).toBe(0);
  });
});

import { describe, it, expect } from 'vitest';
import { feedReason, isFeaturedCompetition, splitFeed, type FeedMatch } from './index.js';

const comp = (over: Partial<FeedMatch> = {}): FeedMatch => ({
  id: 'm', homeTeamId: 'h', awayTeamId: 'a', competitionId: 'c',
  competitionFeaturedRank: null, competitionTier: null, competitionCountry: 'ES', ...over,
});

describe('isFeaturedCompetition', () => {
  it('destacada = curada en datos (featured_rank), no por tener directo', () => {
    expect(isFeaturedCompetition({ featuredRank: 1 })).toBe(true);
    expect(isFeaturedCompetition({ featuredRank: null })).toBe(false);
    expect(isFeaturedCompetition({})).toBe(false);
  });
});

describe('feedReason — por qué un partido sale en Partidos', () => {
  const follows = { teamIds: ['fav'], leagueIds: ['liga-seguida'] };

  it('una competición destacada aparece sin seguirla', () => {
    expect(feedReason(comp({ competitionFeaturedRank: 1 }), {})).toBe('featured');
  });

  it('una competición pequeña no aparece por defecto', () => {
    expect(feedReason(comp({ competitionTier: 3 }), {})).toBeNull();
  });

  it('una competición pequeña aparece al seguirla', () => {
    expect(feedReason(comp({ competitionId: 'liga-seguida' }), follows)).toBe('league');
  });

  it('los partidos de un equipo seguido aparecen aunque su competición no esté destacada', () => {
    expect(feedReason(comp({ awayTeamId: 'fav' }), follows)).toBe('team');
  });

  it('el seguimiento explícito manda: equipo > competición > destacada (un solo motivo)', () => {
    expect(feedReason(comp({ homeTeamId: 'fav', competitionId: 'liga-seguida', competitionFeaturedRank: 1 }), follows)).toBe('team');
    expect(feedReason(comp({ competitionId: 'liga-seguida', competitionFeaturedRank: 1 }), follows)).toBe('league');
  });

  it('dejar de seguir una competición la saca, salvo que haya otra razón', () => {
    const m = comp({ competitionId: 'liga-seguida', homeTeamId: 'fav' });
    expect(feedReason(m, { teamIds: ['fav'], leagueIds: [] })).toBe('team');
    expect(feedReason(comp({ competitionId: 'liga-seguida' }), { teamIds: [], leagueIds: [] })).toBeNull();
  });

  describe('con país preferido', () => {
    it('destacadas de otro país: solo primer nivel o internacionales', () => {
      const pt = (o: Partial<FeedMatch>) => comp({ competitionCountry: 'PT', competitionFeaturedRank: 30, ...o });
      expect(feedReason(pt({ competitionTier: 1 }), { country: 'ES' })).toBe('featured');
      expect(feedReason(pt({ competitionTier: 2 }), { country: 'ES' })).toBeNull();
      expect(feedReason(pt({ competitionTier: 2 }), { country: 'PT' })).toBe('featured');
      expect(feedReason(pt({ competitionTier: 2 }), { country: null })).toBe('featured');
      expect(feedReason(comp({ competitionCountry: 'W', competitionFeaturedRank: 10 }), { country: 'ES' })).toBe('featured');
    });

    it('lo seguido no depende del país', () => {
      expect(feedReason(comp({ competitionCountry: 'IT', competitionId: 'liga-seguida' }), { ...follows, country: 'ES' })).toBe('league');
    });
  });
});

describe('splitFeed', () => {
  it('separa feed y resto sin duplicar (un partido repetido cuenta una vez)', () => {
    const a = comp({ id: '1', competitionFeaturedRank: 1 });
    const b = comp({ id: '2' });
    const { feed, others } = splitFeed([a, b, a], {});
    expect(feed.map((m) => m.id)).toEqual(['1']);
    expect(others.map((m) => m.id)).toEqual(['2']);
  });
});

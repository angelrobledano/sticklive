import { describe, it, expect } from 'vitest';
import { normalizeLiveMatch } from './client';

describe('normalizeLiveMatch', () => {
  it('conserva logo, tier y featured_rank de la competición (deciden el feed de Partidos)', () => {
    const m = normalizeLiveMatch({
      id: 'm', seasonId: 's', roundId: null, status: 'scheduled', scheduledAt: null, startedAt: null,
      score: { home: null, away: null }, venue: null,
      homeTeam: { id: 'h', name: 'H', shortName: null, logoUrl: null },
      awayTeam: { id: 'a', name: 'A', shortName: null, logoUrl: null },
      competitionId: 'c', competitionLogoUrl: 'https://x/logo.png', competitionTier: 1, competitionFeaturedRank: 3,
    } as never);
    expect(m).toMatchObject({ competitionLogoUrl: 'https://x/logo.png', competitionTier: 1, competitionFeaturedRank: 3 });
  });
});

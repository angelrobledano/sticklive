import { describe, expect, it } from 'vitest';
import { madridDateKey } from '@sports/core/match-time';
import { isUpcomingMatch, selectGradaMatches } from './grada';
import type { MatchSummary } from './api/types';

describe('grada', () => {
  const makeMatch = (
    id: string,
    homeId: string,
    awayId: string,
    status: MatchSummary['status'],
    date: string,
    compId = 'c1',
  ): MatchSummary =>
    ({
      id,
      competitionId: compId,
      competitionName: 'OK Liga',
      status,
      scheduledAt: date,
      score: { home: 2, away: 1 },
      homeTeam: { id: homeId, name: 'Home Team', shortName: 'HT', logoUrl: null },
      awayTeam: { id: awayId, name: 'Away Team', shortName: 'AT', logoUrl: null },
    } as unknown as MatchSummary);

  it('formats madrid date key properly', () => {
    expect(madridDateKey('2026-10-22T21:00:00Z')).toBe('2026-10-22');
  });

  it('identifies upcoming matches correctly', () => {
    const scheduled = makeMatch('1', 't1', 't2', 'scheduled', '2026-10-23T18:00:00Z');
    const finished = makeMatch('2', 't1', 't2', 'finished', '2026-10-21T18:00:00Z');
    expect(isUpcomingMatch(scheduled, '2026-10-22')).toBe(true);
    expect(isUpcomingMatch(finished, '2026-10-22')).toBe(false);
  });

  it('selects and sorts upcoming and finished matches for followed teams', () => {
    const m1 = makeMatch('m1', 't1', 't2', 'finished', '2026-10-20T18:00:00Z');
    const m2 = makeMatch('m2', 't1', 't3', 'finished', '2026-10-21T18:00:00Z');
    const m3 = makeMatch('m3', 't4', 't1', 'scheduled', '2026-10-25T18:00:00Z');
    const m4 = makeMatch('m4', 't1', 't5', 'scheduled', '2026-10-24T18:00:00Z');
    const mOther = makeMatch('m5', 'x1', 'x2', 'scheduled', '2026-10-24T18:00:00Z');

    const selection = selectGradaMatches([m1, m2, m3, m4, mOther], {
      teamIds: ['t1'],
      leagueIds: [],
      todayKey: '2026-10-22',
    });

    expect(selection.upcoming.map((m) => m.id)).toEqual(['m4', 'm3']);
    expect(selection.results.map((m) => m.id)).toEqual(['m2', 'm1']);
  });
});

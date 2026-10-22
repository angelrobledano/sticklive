import { describe, expect, it } from 'vitest';
import { buildCompetitionSummary } from './content-summary';
import type { SeasonOverview, SeasonStats } from './api/types';

describe('buildCompetitionSummary', () => {
  const baseOverview: SeasonOverview = {
    season: {
      id: 's1',
      name: '2025/26',
      slug: '2025-26',
      startDate: '2025-09-01T00:00:00Z',
      endDate: '2026-06-30T00:00:00Z',
      competitionId: 'c1',
      competitionName: 'OK Liga Masculina',
      competitionSlug: 'ok-liga-masculina',
      competitionShortName: 'OK Liga',
      competitionLogoUrl: null,
      competitionOrganizer: 'FEP',
      competitionScope: 'national',
      competitionCountry: 'ES',
      competitionRegion: null,
      competitionTimezone: 'Europe/Madrid',
      competitionFormat: 'league',
    },
    standings: [
      {
        id: 'st1',
        teamId: 't1',
        teamName: 'FC Barcelona',
        teamShortName: 'FCB',
        teamLogoUrl: null,
        groupName: null,
        position: 1,
        played: 26,
        won: 24,
        drawn: 1,
        lost: 1,
        goalsFor: 120,
        goalsAgainst: 40,
        goalDiff: 80,
        points: 73,
      },
      {
        id: 'st2',
        teamId: 't2',
        teamName: 'CE Noia Freixenet',
        teamShortName: 'NOI',
        teamLogoUrl: null,
        groupName: null,
        position: 2,
        played: 26,
        won: 18,
        drawn: 3,
        lost: 5,
        goalsFor: 90,
        goalsAgainst: 55,
        goalDiff: 35,
        points: 57,
      },
    ],
    rounds: [
      { id: 'r1', number: 1, name: 'Jornada 1', roundType: 'regular' },
      { id: 'r2', number: 2, name: 'Jornada 2', roundType: 'regular' },
    ],
    matches: [
      {
        id: 'm1',
        status: 'finished',
        competitionTimezone: 'Europe/Madrid',
        scheduledAt: '2025-10-01T18:00:00Z',
        startedAt: null,
        finishedAt: null,
        score: { home: 5, away: 2 },
        winnerTeamId: 't1',
        winType: null,
        penalties: null,
        venueName: null,
        roundId: 'r1',
        groupName: null,
        phaseId: null,
        stage: null,
        seriesGame: null,
        roundNumber: 1,
        roundName: 'Jornada 1',
        roundType: 'regular',
        homeTeam: { id: 't1', name: 'FC Barcelona', shortName: 'FCB', logoUrl: null },
        awayTeam: { id: 't2', name: 'CE Noia Freixenet', shortName: 'NOI', logoUrl: null },
      },
    ],
  };

  const sampleStats: SeasonStats = {
    topScorers: [
      {
        playerId: 'p1',
        playerName: 'BARROSO PEDRO',
        firstName: 'PEDRO',
        lastName: 'BARROSO',
        photoUrl: 'https://example.com/barroso.jpg',
        teamId: 't1',
        teamShort: 'FCB',
        teamName: 'FC Barcelona',
        value: 35,
        extra: 12,
      },
      {
        playerId: 'p2',
        playerName: 'ARAGONÈS JORDI',
        firstName: 'JORDI',
        lastName: 'ARAGONÈS',
        photoUrl: null,
        teamId: 't2',
        teamShort: 'NOI',
        teamName: 'CE Noia Freixenet',
        value: 29,
        extra: 8,
      },
    ],
    topAssists: [],
    topCards: [],
  };

  it('correctly builds summary for a finished season', () => {
    const summary = buildCompetitionSummary(baseOverview, sampleStats);
    expect(summary.status).toBe('finished');
    expect(summary.leader).not.toBeNull();
    expect(summary.leader?.teamName).toBe('FC Barcelona');
    expect(summary.leader?.points).toBe(73);
    expect(summary.leader?.gap).toBe(16);
    expect(summary.leader?.secondTeamName).toBe('CE Noia Freixenet');

    expect(summary.topScorer).not.toBeNull();
    expect(summary.topScorer?.displayName).toBe('Pedro Barroso');
    expect(summary.topScorer?.value).toBe(35);
    expect(summary.topScorer?.gap).toBe(6);
    expect(summary.topScorer?.secondName).toBe('Jordi Aragonès');

    expect(summary.figures).not.toBeNull();
    expect(summary.figures?.matchesPlayed).toBe(1);
    expect(summary.figures?.goalsPerMatch).toBe(7);
    expect(summary.figures?.homeWinPct).toBe(100);
  });

  it('determines in_progress status when pending matches exist', () => {
    const overviewWithPending: SeasonOverview = {
      ...baseOverview,
      matches: [
        ...baseOverview.matches,
        {
          ...baseOverview.matches[0],
          id: 'm2',
          status: 'scheduled',
          scheduledAt: '2026-11-01T18:00:00Z',
          score: { home: null, away: null },
        },
      ],
    };

    const summary = buildCompetitionSummary(overviewWithPending, sampleStats, new Date('2026-10-01T00:00:00Z'));
    expect(summary.status).toBe('in_progress');
  });

  it('builds podium for tournaments with final and 3rd place', () => {
    const tournamentOverview: SeasonOverview = {
      ...baseOverview,
      matches: [
        {
          id: 'mf',
          status: 'finished',
          competitionTimezone: 'Europe/Madrid',
          scheduledAt: '2026-06-01T20:00:00Z',
          startedAt: null,
          finishedAt: null,
          score: { home: 3, away: 1 },
          winnerTeamId: 't1',
          winType: null,
          penalties: null,
          venueName: null,
          roundId: null,
          groupName: null,
          phaseId: null,
          stage: 'final',
          seriesGame: 1,
          roundNumber: 2,
          roundName: 'Final',
          roundType: 'playoff',
          homeTeam: { id: 't1', name: 'FC Barcelona', shortName: 'FCB', logoUrl: null },
          awayTeam: { id: 't2', name: 'CE Noia Freixenet', shortName: 'NOI', logoUrl: null },
        },
        {
          id: 'm3',
          status: 'finished',
          competitionTimezone: 'Europe/Madrid',
          scheduledAt: '2026-06-01T17:00:00Z',
          startedAt: null,
          finishedAt: null,
          score: { home: 4, away: 2 },
          winnerTeamId: 't3',
          winType: null,
          penalties: null,
          venueName: null,
          roundId: null,
          groupName: null,
          phaseId: null,
          stage: 'third_place',
          seriesGame: 1,
          roundNumber: 2,
          roundName: '3.er y 4.º puesto',
          roundType: 'playoff',
          homeTeam: { id: 't3', name: 'Reus Deportiu', shortName: 'REU', logoUrl: null },
          awayTeam: { id: 't4', name: 'HC Liceo', shortName: 'LIC', logoUrl: null },
        },
      ],
    };

    const summary = buildCompetitionSummary(tournamentOverview, null);
    expect(summary.podium).not.toBeNull();
    expect(summary.podium?.gold.teamName).toBe('FC Barcelona');
    expect(summary.podium?.silver.teamName).toBe('CE Noia Freixenet');
    expect(summary.podium?.bronze.teamName).toBe('Reus Deportiu');
  });
});

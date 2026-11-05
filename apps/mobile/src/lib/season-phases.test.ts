import { describe, expect, it } from 'vitest';
import {
  competitionTeamsForIndex,
  competitionVisibleTabs,
  finalPhaseStarted,
  knockoutLayout,
  knockoutTabLabelKey,
} from './season-phases';
import type { SeasonOverview, SeasonMatch, SeasonPhase } from './api/types';

function createMatch(partial: Partial<SeasonMatch>): SeasonMatch {
  return {
    id: 'm1',
    status: 'finished',
    competitionTimezone: 'Europe/Madrid',
    scheduledAt: '2026-05-15T18:00:00Z',
    startedAt: null,
    finishedAt: null,
    score: { home: 3, away: 2 },
    winnerTeamId: null,
    winType: null,
    penalties: null,
    venueName: null,
    roundId: 'r1',
    groupName: null,
    phaseId: 'p1',
    stage: 'quarters',
    seriesGame: 1,
    roundNumber: 1,
    roundName: 'Cuartos 1',
    roundType: 'playoff',
    homeTeam: { id: 'team-a', name: 'Team A', shortName: 'TMA', logoUrl: null },
    awayTeam: { id: 'team-b', name: 'Team B', shortName: 'TMB', logoUrl: null },
    ...partial,
  };
}

describe('season-phases helpers', () => {
  describe('knockoutLayout', () => {
    it('detects series layout when seriesGame >= 3', () => {
      const phase: SeasonPhase = {
        id: 'p1',
        ordinal: 1,
        kind: 'knockout',
        isPlacement: false,
        name: 'Playoffs',
        hasStandings: false,
        stages: ['quarters', 'semis', 'final'],
        stagesInferred: false,
        fromSource: true,
      };
      const matches = [createMatch({ seriesGame: 3 })];
      expect(knockoutLayout(phase, matches)).toBe('series');
    });

    it('detects final_four layout for semis and final', () => {
      const phase: SeasonPhase = {
        id: 'p1',
        ordinal: 1,
        kind: 'knockout',
        isPlacement: false,
        name: 'Final Four',
        hasStandings: false,
        stages: ['semis', 'final'],
        stagesInferred: false,
        fromSource: true,
      };
      const matches = [createMatch({ seriesGame: 1, stage: 'semis' })];
      expect(knockoutLayout(phase, matches)).toBe('final_four');
    });

    it('defaults to bracket layout for single matches / aggregate ties', () => {
      const phase: SeasonPhase = {
        id: 'p1',
        ordinal: 1,
        kind: 'knockout',
        isPlacement: false,
        name: 'Cuadro',
        hasStandings: false,
        stages: ['round_of_16', 'quarters', 'semis', 'final'],
        stagesInferred: false,
        fromSource: true,
      };
      const matches = [createMatch({ seriesGame: null })];
      expect(knockoutLayout(phase, matches)).toBe('bracket');
    });
  });

  describe('finalPhaseStarted', () => {
    it('returns false when there are no playoff matches', () => {
      const matches = [createMatch({ roundType: 'regular', status: 'finished' })];
      expect(finalPhaseStarted(matches)).toBe(false);
    });

    it('returns true when a playoff match has started or finished', () => {
      const matches = [
        createMatch({ roundType: 'regular', status: 'finished' }),
        createMatch({ roundType: 'playoff', status: 'live' }),
      ];
      expect(finalPhaseStarted(matches)).toBe(true);
    });

    it('returns true when regular phase is completely finished even if playoff matches are still scheduled', () => {
      const matches = [
        createMatch({ roundType: 'regular', status: 'finished' }),
        createMatch({ roundType: 'playoff', status: 'scheduled' }),
      ];
      expect(finalPhaseStarted(matches)).toBe(true);
    });

    it('returns false when regular phase still has scheduled matches and playoff hasn not started', () => {
      const matches = [
        createMatch({ roundType: 'regular', status: 'scheduled' }),
        createMatch({ roundType: 'playoff', status: 'scheduled' }),
      ];
      expect(finalPhaseStarted(matches)).toBe(false);
    });
  });

  describe('competitionVisibleTabs', () => {
    const regularMatch = createMatch({ roundType: 'regular', status: 'scheduled' });
    const playoffMatch = createMatch({ roundType: 'playoff', status: 'scheduled' });
    const standingRow = {
      id: 'st1',
      teamId: 'team-a',
      teamName: 'Team A',
      teamShortName: 'TMA',
      teamLogoUrl: null,
      groupName: null,
      position: 1,
      played: 1,
      won: 1,
      drawn: 0,
      lost: 0,
      goalsFor: 3,
      goalsAgainst: 1,
      goalDiff: 2,
      points: 3,
      form: [],
      penalizationPoints: 0,
    };

    it('orders Clasificación first when league is ongoing and playoffs have not started', () => {
      const data: Pick<SeasonOverview, 'standings' | 'matches' | 'rounds'> = {
        standings: [standingRow],
        matches: [regularMatch, playoffMatch],
        rounds: [{ id: 'r1', number: 1, name: 'J1', roundType: 'regular' }],
      };
      const tabs = competitionVisibleTabs(data, null, 'league');
      expect(tabs[0]).toBe('Clasificación');
      expect(tabs).toContain('Jornadas');
      expect(tabs).toContain('Playoffs');
    });

    it('orders Playoffs first when playoffs have started or regular phase is finished', () => {
      const finishedRegular = createMatch({ roundType: 'regular', status: 'finished' });
      const data: Pick<SeasonOverview, 'standings' | 'matches' | 'rounds'> = {
        standings: [standingRow],
        matches: [finishedRegular, playoffMatch],
        rounds: [{ id: 'r1', number: 1, name: 'J1', roundType: 'regular' }],
      };
      const tabs = competitionVisibleTabs(data, null, 'league');
      expect(tabs[0]).toBe('Playoffs');
    });

    it('shows only Playoffs for final_four format (no Clasificación, no Jornadas)', () => {
      const data: Pick<SeasonOverview, 'standings' | 'matches' | 'rounds'> = {
        standings: [],
        matches: [playoffMatch],
        rounds: [{ id: 'r1', number: 1, name: 'Semis', roundType: 'playoff' }],
      };
      const tabs = competitionVisibleTabs(data, null, 'final_four');
      expect(tabs).toEqual(['Playoffs']);
    });
  });

  describe('competitionTeamsForIndex', () => {
    it('returns unique sorted teams from standings and matches', () => {
      const data: Pick<SeasonOverview, 'standings' | 'matches'> = {
        standings: [
          {
            id: '1',
            teamId: 'tb',
            teamName: 'Team Bravo',
            teamShortName: 'TB',
            teamLogoUrl: null,
            groupName: null,
            position: 1,
            played: 0,
            won: 0,
            drawn: 0,
            lost: 0,
            goalsFor: 0,
            goalsAgainst: 0,
            goalDiff: 0,
            points: 0,
            form: [],
            penalizationPoints: 0,
          },
        ],
        matches: [
          createMatch({
            homeTeam: { id: 'ta', name: 'Team Alpha', shortName: 'TA', logoUrl: null },
            awayTeam: { id: 'tb', name: 'Team Bravo', shortName: 'TB', logoUrl: null },
          }),
        ],
      };
      const teams = competitionTeamsForIndex(data);
      expect(teams).toHaveLength(2);
      expect(teams[0].name).toBe('Team Alpha');
      expect(teams[1].name).toBe('Team Bravo');
    });
  });

  describe('knockoutTabLabelKey', () => {
    it('returns playoffs.final_four for final_four format', () => {
      expect(knockoutTabLabelKey('final_four', undefined, [], [])).toBe('playoffs.final_four');
    });

    it('returns match_tabs.playoffs when phases layout is series', () => {
      const phases: SeasonPhase[] = [
        {
          id: 'p1',
          ordinal: 1,
          kind: 'knockout',
          isPlacement: false,
          name: 'Playoffs',
          hasStandings: false,
          stages: ['quarters', 'semis', 'final'],
          stagesInferred: false,
          fromSource: true,
        },
      ];
      const matches = [createMatch({ phaseId: 'p1', seriesGame: 3 })];
      expect(knockoutTabLabelKey('league', phases, [], matches)).toBe('match_tabs.playoffs');
    });

    it('returns match_tabs.knockout when phases layout is bracket', () => {
      const phases: SeasonPhase[] = [
        {
          id: 'p1',
          ordinal: 1,
          kind: 'knockout',
          isPlacement: false,
          name: 'Eliminatorias',
          hasStandings: false,
          stages: ['round_of_16', 'quarters', 'semis', 'final'],
          stagesInferred: false,
          fromSource: true,
        },
      ];
      const matches = [createMatch({ phaseId: 'p1', seriesGame: 1 })];
      expect(knockoutTabLabelKey('tournament', phases, [], matches)).toBe('match_tabs.knockout');
    });
  });
});

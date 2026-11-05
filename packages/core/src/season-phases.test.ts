// ─── Tests de origen web ───
import { describe, it, expect } from 'vitest';
import {
  competitionTeamsForIndex,
  competitionVisibleTabs,
  finalPhaseStarted,
  knockoutLayout,
  knockoutPhaseViews,
  knockoutTabLabelKey,
} from './season-phases';
import type { SeasonMatch, SeasonOverview, SeasonPhase, SeasonRound, KnockoutStage } from './api';

let n = 0;
function phase(over: Partial<SeasonPhase> & Pick<SeasonPhase, 'kind'>): SeasonPhase {
  return { id: `p${++n}`, ordinal: n, isPlacement: false, name: null, hasStandings: false, stages: [], fromSource: true, ...over };
}
function round(p: SeasonPhase, stage: KnockoutStage | null, over: Partial<SeasonRound> = {}): SeasonRound {
  return { id: `r${++n}`, number: 1, name: null, roundType: 'playoff', phaseId: p.id, stage, ...over };
}
function match(p: SeasonPhase, stage: KnockoutStage | null, seriesGame: number | null = null): SeasonMatch {
  const t = (id: string) => ({ id, name: id, shortName: id, logoUrl: null });
  return {
    id: `m${++n}`, status: 'scheduled', scheduledAt: '2026-05-16T18:00:00Z', startedAt: null, finishedAt: null,
    score: { home: null, away: null }, venueName: null, roundId: null, roundNumber: null, roundName: null,
    roundType: 'playoff', phaseId: p.id, stage, seriesGame, homeTeam: t('a'), awayTeam: t('b'),
  };
}

describe('knockoutLayout — el cuadro sale de la estructura, no del formato declarado', () => {
  it('series al mejor de N (la fuente publica el 3.er partido) → series', () => {
    const p = phase({ kind: 'knockout', stages: ['quarters', 'semis', 'final'] });
    expect(knockoutLayout(p, [match(p, 'quarters', 1), match(p, 'quarters', 3)])).toBe('series');
  });

  it('semis → final a partido único → final four (también tras una fase de grupos)', () => {
    const p = phase({ kind: 'knockout', stages: ['semis', 'final'] });
    expect(knockoutLayout(p, [match(p, 'semis'), match(p, 'semis')])).toBe('final_four');
  });

  it('cuartos → semis → final, o ida/vuelta (2 partidos, eliminatoria por goles) → cuadro', () => {
    const p = phase({ kind: 'knockout', stages: ['quarters', 'semis', 'final'] });
    expect(knockoutLayout(p, [match(p, 'quarters')])).toBe('bracket');
    const iv = phase({ kind: 'knockout', stages: [] });
    expect(knockoutLayout(iv, [match(iv, null, 1), match(iv, null, 2)])).toBe('bracket');
  });
});

describe('knockoutPhaseViews', () => {
  it('payload antiguo (sin fases) o fases heredadas → null (presentación de siempre)', () => {
    expect(knockoutPhaseViews(undefined, [], [])).toBeNull();
    expect(knockoutPhaseViews([], [], [])).toBeNull();
    const legacy = phase({ kind: 'knockout', fromSource: false });
    expect(knockoutPhaseViews([legacy], [], [match(legacy, null)])).toBeNull();
  });

  it('liga + playoff + colocación: una vista por fase eliminatoria, con sus partidos y rondas', () => {
    const liga = phase({ kind: 'league', hasStandings: true });
    const po = phase({ kind: 'knockout', stages: ['quarters', 'semis', 'final'] });
    const pl = phase({ kind: 'knockout', isPlacement: true, stages: ['placement'] });
    const qf = round(po, 'quarters');
    const ms = [match(po, 'quarters', 1), match(po, 'quarters', 3), match(pl, 'placement', 1)];
    const views = knockoutPhaseViews([liga, po, pl], [qf], ms)!;
    expect(views.map((v) => [v.phase.id, v.layout, v.matches.length, v.rounds.length])).toEqual([
      [po.id, 'series', 2, 1],
      [pl.id, 'series', 1, 0],
    ]);
  });

  it('grupos + final four: la fase eliminatoria se pinta como final four aunque el formato legado sea "league"', () => {
    const g = phase({ kind: 'groups', hasStandings: true });
    const ff = phase({ kind: 'knockout', stages: ['semis', 'final'] });
    const views = knockoutPhaseViews([g, ff], [round(ff, 'final')], [match(ff, 'semis'), match(ff, 'semis')])!;
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({ layout: 'final_four' });
    // La final aún sin partidos forma parte de la vista (ronda declarada).
    expect(views[0]!.rounds.map((r) => r.stage)).toEqual(['final']);
  });

  it('sin fases eliminatorias → lista vacía', () => {
    expect(knockoutPhaseViews([phase({ kind: 'league' })], [], [])).toEqual([]);
  });
});

describe('finalPhaseStarted — la fase final ya manda en la competición', () => {
  const liga = () => phase({ kind: 'league', hasStandings: true });
  const reg = (status: string): SeasonMatch => ({ ...match(liga(), null), roundType: 'regular', status });
  const ko = (status: string): SeasonMatch => {
    const p = phase({ kind: 'knockout', stages: ['quarters', 'semis', 'final'] });
    return { ...match(p, 'quarters'), status };
  };

  it('liga sin eliminatorias → no', () => {
    expect(finalPhaseStarted([reg('finished'), reg('scheduled')])).toBe(false);
  });

  it('cruces publicados pero la liga/grupos aún abiertos y nada jugado → no', () => {
    expect(finalPhaseStarted([reg('finished'), reg('scheduled'), ko('scheduled')])).toBe(false);
  });

  it('liga/grupos cerrados (terminados o cancelados) y cruces programados → sí', () => {
    expect(finalPhaseStarted([reg('finished'), reg('cancelled'), ko('scheduled')])).toBe(true);
  });

  it('una eliminatoria en juego o terminada → sí (aunque quede un partido de grupos colgado)', () => {
    expect(finalPhaseStarted([reg('scheduled'), ko('live')])).toBe(true);
    expect(finalPhaseStarted([reg('postponed'), ko('finished')])).toBe(true);
  });
});

describe('knockoutTabLabelKey — el nombre de la pestaña según cómo se juega', () => {
  it('series al mejor de N (OK Liga) → Playoffs', () => {
    const p = phase({ kind: 'knockout', stages: ['quarters', 'semis', 'final'] });
    expect(knockoutTabLabelKey('league', [p], [], [match(p, 'quarters', 1), match(p, 'quarters', 3)])).toBe('match_tabs.playoffs');
  });

  it('partido único con cuartos (Mundial) → Eliminatorias', () => {
    const g = phase({ kind: 'groups', hasStandings: true });
    const p = phase({ kind: 'knockout', stages: ['quarters', 'semis', 'final', 'third_place', 'placement'] });
    expect(knockoutTabLabelKey('league', [g, p], [], [match(p, 'quarters'), match(p, 'placement')])).toBe('match_tabs.knockout');
  });

  it('final four (declarada o por estructura) → Final Four', () => {
    expect(knockoutTabLabelKey('final_four', undefined, [], [])).toBe('playoffs.final_four');
    const p = phase({ kind: 'knockout', stages: ['semis', 'final'] });
    expect(knockoutTabLabelKey('league', [p], [], [match(p, 'semis')])).toBe('playoffs.final_four');
  });

  it('temporada heredada sin fases de la fuente → Playoffs (como siempre)', () => {
    expect(knockoutTabLabelKey('league', undefined, [], [])).toBe('match_tabs.playoffs');
  });
});

// ─── Tests de origen app ───

describe('season-phases (origen app)', () => {

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
      expect(teams[0]!.name).toBe('Team Alpha');
      expect(teams[1]!.name).toBe('Team Bravo');
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

});

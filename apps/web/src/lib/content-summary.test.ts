import { describe, it, expect } from 'vitest';
import type { SeasonOverview } from '@/lib/api/types';
import { buildCompetitionSummary, buildCrossMetrics, buildMatchPreview, buildPreviousMeeting, buildTeamObservations } from './content-summary';

function match(overrides: Partial<SeasonOverview['matches'][number]> = {}): SeasonOverview['matches'][number] {
  return {
    id: 'm1', status: 'finished', scheduledAt: '2026-10-01T18:00:00Z', startedAt: null,
    finishedAt: '2026-10-01T19:30:00Z', score: { home: 2, away: 1 },
    homeTeam: { id: 'h', name: 'Local', shortName: null, logoUrl: null },
    awayTeam: { id: 'a', name: 'Visitante', shortName: null, logoUrl: null },
    roundId: null, roundNumber: 1, roundName: 'Jornada 1', roundType: 'regular',
    ...overrides,
  } as SeasonOverview['matches'][number];
}

const overview = {
  season: { id: 's1', name: '2026/27', competitionId: 'c1', competitionName: 'Liga' },
  standings: [
    { teamId: 'h', teamName: 'Local', position: 1, played: 5, points: 13, form: ['W', 'W', 'D'] },
    { teamId: 'a', teamName: 'Visitante', position: 3, played: 5, points: 8, form: ['L', 'W', 'L'] },
  ],
  rounds: [],
  matches: [
    match({ id: 'prev', homeTeam: { id: 'a', name: 'Visitante', shortName: null, logoUrl: null }, awayTeam: { id: 'h', name: 'Local', shortName: null, logoUrl: null }, score: { home: 0, away: 2 } }),
    match({ id: 'current', status: 'scheduled', scheduledAt: '2026-10-20T18:00:00Z', score: { home: null, away: null } }),
    match({ id: 'other', homeTeam: { id: 'x', name: 'Otro', shortName: null, logoUrl: null }, awayTeam: { id: 'y', name: 'Rival', shortName: null, logoUrl: null } }),
  ],
} as unknown as SeasonOverview;

describe('buildMatchPreview', () => {
  it('devuelve posición, forma y H2H del mismo emparejamiento', () => {
    const preview = buildMatchPreview(overview, {
      matchId: 'current', homeTeamId: 'h', awayTeamId: 'a', homeName: 'Local', awayName: 'Visitante',
    });
    expect(preview.home.position).toBe(1);
    expect(preview.home.form).toEqual(['W', 'W', 'D']);
    expect(preview.headToHead).toHaveLength(1);
    expect(preview.headToHead[0]?.id).toBe('prev');
  });

  it('no repite el partido actual en los últimos 5 (directo/finalizado)', () => {
    const recent = (id: string) => ({
      id, date: '2026-10-20T18:00:00Z',
      homeTeamId: 'h', homeName: 'Local', homeShortName: null, homeLogoUrl: null,
      awayTeamId: 'a', awayName: 'Visitante', awayShortName: null, awayLogoUrl: null,
      homeScore: 1, awayScore: 0, competitionId: 'c1', competitionName: 'Liga',
      competitionShortName: null, roundNumber: 1,
    });
    const preview = buildMatchPreview(overview, {
      matchId: 'current', homeTeamId: 'h', awayTeamId: 'a', homeName: 'Local', awayName: 'Visitante',
    }, {
      homeRecent: [recent('current'), recent('r1')],
      awayRecent: [recent('current'), recent('r2')],
    });
    expect(preview.home.recent.map((r) => r.id)).not.toContain('current');
    expect(preview.away.recent.map((r) => r.id)).not.toContain('current');
  });
});

const team = (id: string, name = id.toUpperCase()) => ({ id, name, shortName: null, logoUrl: null });
const row = (teamId: string, position: number, points: number, played: number, extra: Record<string, unknown> = {}) =>
  ({ teamId, teamName: `CLUB ${teamId.toUpperCase()}`, position, points, played, form: [], groupName: null, ...extra });

/** Liga de 4 equipos a 6 jornadas (12 partidos): 4 jornadas jugadas. */
function liga(opts: { pending?: boolean } = {}): SeasonOverview {
  const pairs: Array<[string, string]> = [['a', 'b'], ['c', 'd'], ['a', 'c'], ['b', 'd'], ['a', 'd'], ['b', 'c']];
  const matches = [];
  for (let r = 1; r <= 6; r++) {
    for (const [h, a] of pairs.slice(((r - 1) % 3) * 2, ((r - 1) % 3) * 2 + 2)) {
      const played = r <= 4 || !opts.pending;
      matches.push(match({
        id: `r${r}-${h}${a}`, roundNumber: r, roundName: `JORNADA ${r}`,
        status: played ? 'finished' : 'scheduled',
        scheduledAt: `2026-10-${String(r * 2).padStart(2, '0')}T18:00:00Z`,
        homeTeam: team(h), awayTeam: team(a),
        score: played ? { home: 3, away: 1 } : { home: null, away: null },
      }));
    }
  }
  return {
    season: { id: 's1', name: '2026/27', competitionId: 'c1', competitionName: 'Liga', phases: [] },
    standings: [row('a', 1, 12, 4), row('b', 2, 9, 4), row('c', 3, 7, 4), row('d', 4, 3, 4)],
    rounds: [1, 2, 3, 4, 5, 6].map((n) => ({ id: `rd${n}`, number: n, name: `JORNADA ${n}`, roundType: 'regular' })),
    matches,
  } as unknown as SeasonOverview;
}

const scorers = {
  topScorers: [
    { playerId: 'p1', playerName: 'FERNANDEZ DELGADO JUAN GABRIEL', firstName: 'JUAN GABRIEL', lastName: 'FERNANDEZ DELGADO', photoUrl: null, teamId: 'a', teamShort: null, teamName: 'CLUB A', value: 9, extra: 0 },
    { playerId: 'p2', playerName: 'PUJOL QUINTANA GERARD', photoUrl: null, teamId: 'b', teamShort: null, teamName: 'CLUB B', value: 7, extra: 0 },
  ],
  topAssists: [], topCards: [],
};

describe('buildCompetitionSummary', () => {
  const now = new Date('2026-10-09T00:00:00Z');

  it('una liga con jornadas es "league"; final four, cuadro o grupos son "tournament"', () => {
    expect(buildCompetitionSummary(liga({ pending: true }), scorers, now).kind).toBe('league');
    const ff = liga({ pending: true });
    (ff.season as { competitionFormat?: string }).competitionFormat = 'final_four';
    expect(buildCompetitionSummary(ff, scorers, now).kind).toBe('tournament');
    const grupos = liga({ pending: true });
    grupos.standings = grupos.standings.map((r, i) => ({ ...r, groupName: i < 2 ? 'A' : 'B' }));
    expect(buildCompetitionSummary(grupos, scorers, now).kind).toBe('tournament');
    const cuadro = liga({ pending: true });
    cuadro.rounds = cuadro.rounds.map((r) => ({ ...r, roundType: 'playoff' }));
    expect(buildCompetitionSummary(cuadro, scorers, now).kind).toBe('tournament');
  });

  it('jornada en curso sobre el total de jornadas de liga', () => {
    const s = buildCompetitionSummary(liga({ pending: true }), scorers, now);
    expect(s.status).toBe('in_progress');
    expect(s.matchday).toEqual({ current: 4, total: 6 });
  });

  it('líder con su ventaja sobre el segundo y enlace por id', () => {
    const s = buildCompetitionSummary(liga({ pending: true }), scorers, now);
    expect(s.leader).toMatchObject({ teamId: 'a', teamName: 'CLUB A', points: 12, gap: 3, secondTeamName: 'CLUB B' });
  });

  it('partido destacado: el de la próxima jornada entre los mejor clasificados', () => {
    const s = buildCompetitionSummary(liga({ pending: true }), scorers, now);
    // Jornada 5: a-c (1.º contra 3.º) y b-d (2.º contra 4.º).
    expect(s.featured).toMatchObject({ id: 'r5-ac', homePosition: 1, awayPosition: 3, roundNumber: 5 });
  });

  it('un aplazado entre semana no tapa el partido grande del fin de semana', () => {
    const o = liga({ pending: true });
    o.matches.push(match({
      id: 'aplazado', roundNumber: 2, status: 'scheduled', scheduledAt: '2026-10-09T18:00:00Z',
      homeTeam: team('c'), awayTeam: team('d'), score: { home: null, away: null },
    }));
    expect(buildCompetitionSummary(o, scorers, now).featured?.id).toBe('r5-ac');
  });

  it('pichichi con nombre de presentación y ventaja', () => {
    const s = buildCompetitionSummary(liga({ pending: true }), scorers, now);
    expect(s.topScorer).toMatchObject({
      playerId: 'p1', displayName: 'Juan Gabriel Fernandez', value: 9, gap: 2, teamId: 'a',
      secondName: 'Gerard Pujol',
    });
  });

  it('sin nombre y apellidos de la API, cae al nombre crudo', () => {
    const s = buildCompetitionSummary(liga({ pending: true }), { ...scorers, topScorers: [scorers.topScorers[1]!] }, now);
    expect(s.topScorer?.displayName).toBe('Gerard Pujol');
  });

  it('cifras de la liga desde los resultados', () => {
    const s = buildCompetitionSummary(liga({ pending: true }), scorers, now);
    expect(s.figures).toEqual({ matchesPlayed: 8, goalsPerMatch: 4, homeWinPct: 100 });
  });

  it('temporada terminada: estado finished y sin partido destacado', () => {
    const s = buildCompetitionSummary(liga(), scorers, now);
    expect(s.status).toBe('finished');
    expect(s.matchday).toEqual({ current: 6, total: 6 });
    expect(s.featured).toBeNull();
  });

  it('medallero desde la final y el partido por el 3.º y 4.º puesto', () => {
    const o = liga();
    o.matches.push(
      match({
        id: 'final', status: 'finished', roundType: 'playoff', roundName: 'Final', stage: 'final',
        homeTeam: team('a'), awayTeam: team('b'),
        score: { home: 2, away: 2 }, penalties: { home: 3, away: 4 }, winnerTeamId: 'b',
      }),
      match({
        id: 'third', status: 'finished', roundType: 'playoff', roundName: '3º y 4º puesto', stage: 'third_place',
        homeTeam: team('c'), awayTeam: team('d'),
        score: { home: 3, away: 5 }, winnerTeamId: 'd',
      }),
    );
    expect(buildCompetitionSummary(o, scorers, now).podium).toEqual({
      gold: { teamId: 'b', teamName: 'B' },
      silver: { teamId: 'a', teamName: 'A' },
      bronze: { teamId: 'd', teamName: 'D' },
    });
  });

  it('sin partido por el bronce no inventa un medallero', () => {
    const o = liga();
    o.matches.push(match({
      id: 'final', status: 'finished', roundType: 'playoff', roundName: 'Final', stage: 'final',
      homeTeam: team('a'), awayTeam: team('b'), score: { home: 1, away: 0 }, winnerTeamId: 'a',
    }));
    expect(buildCompetitionSummary(o, scorers, now).podium).toBeNull();
  });

  it('final four a partido único: campeón y subcampeón de la final, sin líder por puntos ni % de victorias locales', () => {
    const ff = {
      season: { id: 's1', name: '2026/27', competitionId: 'c1', competitionName: 'Supercopa', competitionFormat: 'final_four', phases: [] },
      // La API calcula una tabla con los resultados de la copa: no significa nada.
      standings: [row('b', 1, 4, 2), row('a', 2, 4, 2), row('c', 3, 0, 1), row('d', 4, 0, 1)],
      rounds: [],
      matches: [
        match({ id: 's1', roundType: 'playoff', stage: 'semis', homeTeam: team('d'), awayTeam: team('b'), score: { home: 3, away: 5 } }),
        match({ id: 's2', roundType: 'playoff', stage: 'semis', homeTeam: team('a'), awayTeam: team('c'), score: { home: 2, away: 1 } }),
        match({
          id: 'final', roundType: 'playoff', stage: 'final', roundName: 'Final', homeTeam: team('b'), awayTeam: team('a'),
          score: { home: 2, away: 2 }, penalties: { home: 3, away: 2 }, winnerTeamId: 'b',
        }),
      ],
    } as unknown as SeasonOverview;
    const s = buildCompetitionSummary(ff, scorers, now);
    expect(s.kind).toBe('tournament');
    expect(s.leader).toBeNull();
    expect(s.champion).toEqual({
      teamId: 'b', teamName: 'B', runnerUpId: 'a', runnerUpName: 'A', matchId: 'final',
    });
    expect(s.figures?.homeWinPct).toBeNull();
  });

  it('copa en curso sin final jugada: ni líder ni campeón', () => {
    const ff = {
      season: { id: 's1', name: '2026/27', competitionId: 'c1', competitionName: 'Supercopa', competitionFormat: 'final_four', phases: [] },
      standings: [row('b', 1, 2, 1), row('a', 2, 2, 1)],
      rounds: [],
      matches: [
        match({ id: 's1', roundType: 'playoff', stage: 'semis', homeTeam: team('d'), awayTeam: team('b'), score: { home: 3, away: 5 } }),
        match({ id: 'final', roundType: 'playoff', stage: 'final', status: 'scheduled', scheduledAt: '2026-10-20T18:00:00Z',
          homeTeam: team('b'), awayTeam: team('a'), score: { home: null, away: null } }),
      ],
    } as unknown as SeasonOverview;
    const s = buildCompetitionSummary(ff, scorers, now);
    expect(s.leader).toBeNull();
    expect(s.champion).toBeNull();
    expect(s.featured).toMatchObject({ id: 'final', homePosition: null, awayPosition: null });
  });

  it('liga sin final: sin campeón, el 1.º de la tabla sigue siendo líder', () => {
    const s = buildCompetitionSummary(liga(), scorers, now);
    expect(s.champion).toBeNull();
    expect(s.leader?.teamId).toBe('a');
  });

  it('con varios grupos no hay un líder único', () => {
    const o = liga({ pending: true });
    o.standings = [row('a', 1, 12, 4, { groupName: 'A' }), row('b', 1, 9, 4, { groupName: 'B' })] as never;
    expect(buildCompetitionSummary(o, scorers, now).leader).toBeNull();
  });

  it('no inventa un líder si nadie ha jugado', () => {
    const o = liga({ pending: true });
    o.standings = o.standings.map((x) => ({ ...x, played: 0 }));
    expect(buildCompetitionSummary(o, null, now).leader).toBeNull();
  });
});
describe('C9: observaciones y n�meros del cruce', () => {
  const recent = [
    { id: '1', date: null, opponentId: 'x', opponentName: 'X', opponentLogoUrl: null, competitionName: null, isHome: true, goalsFor: 4, goalsAgainst: 1, result: 'W' as const },
    { id: '2', date: null, opponentId: 'y', opponentName: 'Y', opponentLogoUrl: null, competitionName: null, isHome: false, goalsFor: 3, goalsAgainst: 2, result: 'W' as const },
    { id: '3', date: null, opponentId: 'z', opponentName: 'Z', opponentLogoUrl: null, competitionName: null, isHome: true, goalsFor: 2, goalsAgainst: 0, result: 'W' as const },
  ];

  it('solo publica observaciones que superan su umbral', () => {
    const facts = buildTeamObservations(recent, null);
    expect(facts.some((f) => f.kind === 'recent_goals' && f.value === 9)).toBe(true);
    expect(facts.some((f) => f.kind === 'win_streak' && f.value === 3)).toBe(true);
    expect(facts.some((f) => f.kind === 'home_wins' && f.value === 2)).toBe(true);
    expect(buildTeamObservations([], null)).toEqual([]);
  });

  const stats = {
    played: 5, goalsFor: 15, goalsAgainst: 5, teamFouls: 40,
    blueCards: 4, redCards: 0,
    directFouls: { total: 10, scored: 2, pct: 20 },
    penalties: { total: 4, scored: 3, pct: 75 },
  } as never;

  it('calcula minutos por gol y faltas por partido', () => {
    const cross = buildCrossMetrics(stats, stats);
    expect(cross.find((m) => m.key === 'minutes_goal')).toMatchObject({ home: 17, away: 17, unit: 'minutes' });
    expect(cross.find((m) => m.key === 'fouls')).toMatchObject({ home: 8, away: 8 });
    expect(cross.find((m) => m.key === 'penalty_pct')).toMatchObject({ home: 75, away: 75 });
  });
});

describe('F5-4: enlace al partido anterior', () => {
  it('elige el enfrentamiento anterior de los mismos equipos', () => {
    expect(buildPreviousMeeting(overview, {
      matchId: 'current', homeTeamId: 'h', awayTeamId: 'a', date: '2026-10-20T18:00:00Z',
    })).toMatchObject({ id: 'prev', homeName: 'Visitante', awayName: 'Local' });
  });

  it('no inventa un anterior si no existe', () => {
    expect(buildPreviousMeeting(overview, {
      matchId: 'prev', homeTeamId: 'h', awayTeamId: 'a', date: '2026-10-01T18:00:00Z',
    })).toBeNull();
  });
});

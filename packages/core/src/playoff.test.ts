import { describe, it, expect } from 'vitest';
import type { SeasonMatch, TeamSummary } from './api';
import {
  advancedFrom,
  buildSeries,
  gameWinnerId,
  groupByPhase,
  placementMatches,
  seriesWinnerId,
  type PlayoffSeries,
} from './playoff';

/**
 * Lógica de series de playoff: ganador por partido (penaltis/prórroga mandan
 * sobre el marcador) y campeón de una serie ya cerrada (todas las partidas
 * terminadas y un equipo por delante).
 */

function team(id: string, name = id): TeamSummary {
  return { id, name, shortName: name, logoUrl: null };
}

let seq = 0;
function game(over: Partial<SeasonMatch> = {}): SeasonMatch {
  seq += 1;
  return {
    id: over.id ?? `g${seq}`,
    status: 'finished',
    scheduledAt: `2026-05-${String(seq).padStart(2, '0')}`,
    startedAt: null,
    finishedAt: null,
    score: { home: 1, away: 0 },
    winnerTeamId: null,
    winType: null,
    venueName: null,
    roundId: null,
    roundNumber: 3,
    roundName: null,
    roundType: 'playoff',
    homeTeam: team('A'),
    awayTeam: team('B'),
    ...over,
  } as SeasonMatch;
}

describe('gameWinnerId', () => {
  it('prioriza el ganador explícito (penaltis/prórroga) sobre el marcador', () => {
    expect(gameWinnerId(game({ score: { home: 2, away: 2 }, winnerTeamId: 'B' }))).toBe('B');
  });

  it('deriva el ganador del marcador cuando no hay ganador explícito', () => {
    expect(gameWinnerId(game({ homeTeam: team('A'), awayTeam: team('B'), score: { home: 4, away: 1 } }))).toBe('A');
    expect(gameWinnerId(game({ homeTeam: team('A'), awayTeam: team('B'), score: { home: 1, away: 3 } }))).toBe('B');
  });

  it('un empate sin ganador explícito no tiene ganador', () => {
    expect(gameWinnerId(game({ score: { home: 2, away: 2 }, winnerTeamId: null }))).toBeNull();
  });
});

describe('seriesWinnerId — campeón de una serie cerrada', () => {
  const A = team('A');
  const B = team('B');
  const played = (id: string, home: number, away: number, extra: Partial<SeasonMatch> = {}) =>
    game({ id, homeTeam: A, awayTeam: B, score: { home, away }, ...extra });

  it('devuelve al que más victorias suma con todas las partidas terminadas', () => {
    const serie: PlayoffSeries = {
      games: [
        played('g1', 8, 2),
        played('g2', 8, 2),
        played('g3', 2, 5),
        played('g4', 2, 4),
        played('g5', 2, 2, { winnerTeamId: 'B', winType: 'penalties' }),
      ],
      teamA: A,
      teamB: B,
      winsA: 2,
      winsB: 3,
    };
    expect(seriesWinnerId(serie)).toBe('B');
  });

  it('no declara ganador con una partida en juego', () => {
    const serie: PlayoffSeries = {
      games: [played('g1', 8, 2, { status: 'live' })],
      teamA: A, teamB: B, winsA: 1, winsB: 0,
    };
    expect(seriesWinnerId(serie)).toBeNull();
  });

  it('no declara ganador con una partida pendiente (serie aún abierta)', () => {
    const serie: PlayoffSeries = {
      games: [played('g1', 8, 2), played('g2', 0, 0, { status: 'scheduled' })],
      teamA: A, teamB: B, winsA: 1, winsB: 0,
    };
    expect(seriesWinnerId(serie)).toBeNull();
  });

  it('no declara ganador con la serie empatada', () => {
    const serie: PlayoffSeries = {
      games: [played('g1', 8, 2), played('g2', 2, 4)],
      teamA: A, teamB: B, winsA: 1, winsB: 1,
    };
    expect(seriesWinnerId(serie)).toBeNull();
  });
});

describe('buildSeries — recuento de victorias', () => {
  it('cuenta penaltis/prórroga y omite empates sin ganador', () => {
    const A = team('A');
    const B = team('B');
    const played = (id: string, home: number, away: number, extra: Partial<SeasonMatch> = {}) =>
      game({ id, homeTeam: A, awayTeam: B, score: { home, away }, ...extra });

    const series = buildSeries([
      played('g1', 8, 2),
      played('g2', 8, 2),
      played('g3', 2, 5),
      played('g4', 2, 4),
      played('g5', 2, 2, { winnerTeamId: 'B', winType: 'penalties' }),
    ]);

    expect(series).toHaveLength(1);
    expect(series[0]!.winsA).toBe(2);
    expect(series[0]!.winsB).toBe(3);
  });
});

describe('playoff (casos de la app)', () => {
  const tm = (id: string, name = id): TeamSummary => ({ id, name, shortName: name, logoUrl: null });

  it('gameWinnerId resuelve un empate por la tanda de penaltis', () => {
    const g = game({ score: { home: 2, away: 2 }, penalties: { home: 3, away: 1 }, homeTeam: tm('A'), awayTeam: tm('B') });
    expect(gameWinnerId(g)).toBe('A');
  });

  it('gameWinnerId devuelve null con empate sin tanda o sin marcador', () => {
    expect(gameWinnerId(game({ score: { home: 2, away: 2 }, penalties: null }))).toBeNull();
    expect(gameWinnerId(game({ score: { home: null, away: null } }))).toBeNull();
  });

  it('buildSeries agrupa partidos de ida y vuelta entre dos equipos', () => {
    const A = tm('A');
    const B = tm('B');
    const series = buildSeries([
      game({ id: 'g1', scheduledAt: '2026-05-10T18:00:00Z', score: { home: 4, away: 1 }, homeTeam: A, awayTeam: B }),
      game({ id: 'g2', scheduledAt: '2026-05-12T18:00:00Z', score: { home: 3, away: 2 }, homeTeam: B, awayTeam: A }),
      game({ id: 'g3', scheduledAt: '2026-05-15T18:00:00Z', score: { home: 5, away: 2 }, homeTeam: A, awayTeam: B }),
    ]);
    expect(series).toHaveLength(1);
    expect(series[0]!.winsA).toBe(2);
    expect(series[0]!.winsB).toBe(1);
    expect(seriesWinnerId(series[0]!)).toBe('A');
  });

  it('groupByPhase reparte por stage y placementMatches aísla la colocación', () => {
    const qf = game({ id: 'q1', stage: 'quarters' });
    const sf = game({ id: 's1', stage: 'semis' });
    const f = game({ id: 'f1', stage: 'final' });
    const pl = game({ id: 'p1', stage: 'placement' });
    const grouped = groupByPhase([qf, sf, f, pl]);
    expect(grouped.Cuartos).toHaveLength(1);
    expect(grouped.Semis).toHaveLength(1);
    expect(grouped.Final).toHaveLength(1);
    expect(placementMatches([qf, sf, f, pl]).map((m) => m.id)).toEqual(['p1']);
  });

  it('Final Four sin stage (3 partidos con la misma ronda): dos semis y la final por fecha', () => {
    const mk = (id: string, at: string, home: string, away: string) => game({
      id, stage: null, roundNumber: 4, roundName: 'FINAL', scheduledAt: at,
      homeTeam: tm(home), awayTeam: tm(away),
    });
    // Desordenados a propósito: el reparto va por fecha, no por posición.
    const grouped = groupByPhase([
      mk('f1', '2025-09-21T10:15:00Z', 'B', 'C'),
      mk('s1', '2025-09-20T14:15:00Z', 'A', 'B'),
      mk('s2', '2025-09-20T16:45:00Z', 'C', 'D'),
    ]);
    expect(grouped.Cuartos).toHaveLength(0);
    expect(grouped.Semis.map((m) => m.id)).toEqual(['s1', 's2']);
    expect(grouped.Final.map((m) => m.id)).toEqual(['f1']);
  });

  it('3 cuartos sin stage con 6 equipos distintos no se toman por un Final Four', () => {
    const mk = (id: string, at: string, home: string, away: string) => game({
      id, stage: null, roundNumber: 2, scheduledAt: at, homeTeam: tm(home), awayTeam: tm(away),
    });
    const grouped = groupByPhase([
      mk('q1', '2026-05-10T18:00:00Z', 'A', 'B'),
      mk('q2', '2026-05-10T20:00:00Z', 'C', 'D'),
      mk('q3', '2026-05-11T18:00:00Z', 'E', 'F'),
    ]);
    expect(grouped.Final).toHaveLength(0);
    expect(grouped.Semis.map((m) => m.id)).not.toEqual(['q1', 'q2']);
  });

  it('tres partidos de una serie al mejor de 3 entre los mismos equipos (ronda 3) siguen yendo a Final', () => {
    const A = tm('A');
    const B = tm('B');
    const mk = (id: string, at: string) => game({
      id, stage: null, roundNumber: 3, scheduledAt: at, homeTeam: A, awayTeam: B,
    });
    const grouped = groupByPhase([
      mk('g1', '2026-05-10T18:00:00Z'),
      mk('g2', '2026-05-12T18:00:00Z'),
      mk('g3', '2026-05-15T18:00:00Z'),
    ]);
    expect(grouped.Semis).toHaveLength(0);
    expect(grouped.Final.map((m) => m.id)).toEqual(['g1', 'g2', 'g3']);
  });

  it('2 cuartos heredados más 1 partido de colocación (ronda 0): la colocación sigue fuera del cuadro', () => {
    const q1 = game({ id: 'q1', stage: null, roundNumber: 1, scheduledAt: '2026-05-10T18:00:00Z',
      homeTeam: tm('A'), awayTeam: tm('B') });
    const q2 = game({ id: 'q2', stage: null, roundNumber: 1, scheduledAt: '2026-05-11T18:00:00Z',
      homeTeam: tm('C'), awayTeam: tm('D') });
    const pl = game({ id: 'p1', stage: null, roundNumber: 0, scheduledAt: '2026-05-12T18:00:00Z',
      homeTeam: tm('E'), awayTeam: tm('F') });
    const grouped = groupByPhase([q1, q2, pl]);
    expect(grouped.Cuartos.map((m) => m.id)).toEqual(['q1', 'q2']);
    expect(grouped.Semis).toHaveLength(0);
    expect(grouped.Final).toHaveLength(0);
    expect(placementMatches([q1, q2, pl]).map((m) => m.id)).toEqual(['p1']);
  });

  it('advancedFrom devuelve los equipos presentes en la fase siguiente', () => {
    const sf = buildSeries([game({ homeTeam: tm('A'), awayTeam: tm('C') })]);
    const advanced = advancedFrom(sf);
    expect(advanced.has('A')).toBe(true);
    expect(advanced.has('C')).toBe(true);
    expect(advanced.has('B')).toBe(false);
  });
});

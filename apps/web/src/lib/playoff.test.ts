import { describe, it, expect } from 'vitest';
import type { SeasonMatch, TeamSummary } from '@/lib/api/client';
import { buildSeries, gameWinnerId, seriesWinnerId, type PlayoffSeries } from './playoff';

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

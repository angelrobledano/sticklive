import { describe, it, expect } from 'vitest';
import type { SeasonMatch, TeamSummary } from '@/lib/api/client';
import { buildBracketRounds } from './bracket';

function team(id: string): TeamSummary {
  return { id, name: id.toUpperCase(), shortName: id.toUpperCase(), logoUrl: null };
}

let seq = 0;
function m(id: string, home: string, away: string, over: Partial<SeasonMatch> = {}): SeasonMatch {
  seq += 1;
  return {
    id,
    status: 'finished',
    scheduledAt: `2026-03-${String(10 + seq).padStart(2, '0')}T12:00:00Z`,
    startedAt: null,
    finishedAt: null,
    score: { home: 1, away: 0 },
    winnerTeamId: home,
    winType: null,
    venueName: null,
    roundId: 'r',
    roundNumber: 4,
    roundName: 'FINAL',
    roundType: 'playoff',
    homeTeam: team(home),
    awayTeam: team(away),
    ...over,
  } as SeasonMatch;
}

const keys = (rs: ReturnType<typeof buildBracketRounds>) => rs.map((r) => r.key);
const sizes = (rs: ReturnType<typeof buildBracketRounds>) => rs.map((r) => r.matches.length);

describe('buildBracketRounds', () => {
  it('Copa del Rey: fuente con todo "FINAL" → deduce Cuartos/Semis/Final por avance', () => {
    const ms = [
      // Cuartos (4 cruces, 8 equipos)
      m('q1', 'a', 'b'), m('q2', 'c', 'd'), m('q3', 'e', 'f'), m('q4', 'g', 'h'),
      // Semis (ganadores de cuartos)
      m('s1', 'a', 'c'), m('s2', 'e', 'g'),
      // Final
      m('f1', 'a', 'e'),
    ];
    expect(keys(buildBracketRounds(ms))).toEqual(['quarters', 'semis', 'final']);
    expect(sizes(buildBracketRounds(ms))).toEqual([4, 2, 1]);
  });

  it('a 4 equipos (2 semis + final) → Semis/Final', () => {
    const ms = [m('s1', 'a', 'b'), m('s2', 'c', 'd'), m('f1', 'a', 'c')];
    expect(keys(buildBracketRounds(ms))).toEqual(['semis', 'final']);
    expect(sizes(buildBracketRounds(ms))).toEqual([2, 1]);
  });

  it('si la fuente nombra las fases, se respeta el nombre', () => {
    const ms = [
      m('q1', 'a', 'b', { roundName: 'Cuartos', roundNumber: 1, roundId: 'q' }),
      m('q2', 'c', 'd', { roundName: 'Cuartos', roundNumber: 1, roundId: 'q' }),
      m('s1', 'a', 'c', { roundName: 'Semis', roundNumber: 2, roundId: 's' }),
      m('f1', 'a', 'e', { roundName: 'Final', roundNumber: 3, roundId: 'f' }),
    ];
    expect(keys(buildBracketRounds(ms))).toEqual(['quarters', 'semis', 'final']);
  });

  it('una sola eliminatoria de ida/vuelta → una ronda (sin cuadro inventado)', () => {
    const ms = [
      m('l1', 'a', 'b', { roundName: 'Jornada 1', roundNumber: 9, roundId: 'x', score: { home: 3, away: 1 } }),
      m('l2', 'b', 'a', { roundName: 'Jornada 2', roundNumber: 10, roundId: 'y', score: { home: 0, away: 2 } }),
    ];
    const rs = buildBracketRounds(ms);
    expect(rs).toHaveLength(1);
    expect(rs[0]!.matches).toHaveLength(2);
  });

  it('sin resultados (aún sin jugar) no inventa fases → una sola ronda', () => {
    const ms = [
      m('q1', 'a', 'b', { status: 'scheduled', score: { home: null, away: null }, winnerTeamId: null }),
      m('q2', 'c', 'd', { status: 'scheduled', score: { home: null, away: null }, winnerTeamId: null }),
    ];
    const rs = buildBracketRounds(ms);
    expect(rs).toHaveLength(1);
    expect(rs[0]!.matches).toHaveLength(2);
  });

  it('sin partidos devuelve []', () => {
    expect(buildBracketRounds([])).toEqual([]);
  });
});

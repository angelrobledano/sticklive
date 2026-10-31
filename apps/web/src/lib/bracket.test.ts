import { describe, it, expect } from 'vitest';
import type { SeasonMatch, TeamSummary } from '@/lib/api/client';
import { buildBracketRounds, completeBracket, slotFeeders } from './bracket';

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

describe('completeBracket', () => {
  const q = (id: string, h: string, a: string) =>
    m(id, h, a, { stage: 'quarters', roundId: 'rq', roundName: '1/4 Final', status: 'scheduled', score: { home: null, away: null }, winnerTeamId: null } as Partial<SeasonMatch>);
  const declared = [
    { id: 'rq', number: 20, name: '1/4 Final', roundType: 'playoff' as const, stage: 'quarters' as const },
    { id: 'rs', number: 30, name: '1/2 Final', roundType: 'playoff' as const, stage: 'semis' as const },
    { id: 'rf', number: 40, name: 'Final', roundType: 'playoff' as const, stage: 'final' as const },
  ];

  it('Elite Cup: solo cuartos publicados → semis y final como huecos del cuadro (4 → 2 → 1)', () => {
    const rounds = completeBracket(buildBracketRounds([q('1', 'a', 'b'), q('2', 'c', 'd'), q('3', 'e', 'f'), q('4', 'g', 'h')]), declared);
    expect(rounds.map((r) => [r.key, r.matches.length, r.slots])).toEqual([
      ['quarters', 4, 4], ['semis', 0, 2], ['final', 0, 1],
    ]);
  });

  it('semis con un solo cruce publicado: el otro queda como hueco', () => {
    const semi = m('s1', 'a', 'c', { stage: 'semis', roundId: 'rs', roundName: '1/2 Final' } as Partial<SeasonMatch>);
    const rounds = completeBracket(
      buildBracketRounds([q('1', 'a', 'b'), q('2', 'c', 'd'), q('3', 'e', 'f'), q('4', 'g', 'h'), semi]), declared);
    expect(rounds.map((r) => r.slots)).toEqual([4, 2, 1]);
  });

  it('cada semifinal queda junto a los dos cuartos que la alimentan (1+4 y 2+3)', () => {
    const qf = (id: string, h: string, a: string) =>
      m(id, h, a, { stage: 'quarters', roundId: 'rq', roundName: '1/4 Final' } as Partial<SeasonMatch>);
    const sf = (id: string, h: string, a: string) =>
      m(id, h, a, { stage: 'semis', roundId: 'rs', roundName: '1/2 Final', status: 'scheduled', score: { home: null, away: null }, winnerTeamId: null } as Partial<SeasonMatch>);
    const rounds = completeBracket(buildBracketRounds([
      qf('1', 'ben', 'col'), qf('2', 'sim', 'spo'), qf('3', 'por', 'san'), qf('4', 'sad', 'bra'),
      sf('s1', 'ben', 'sad'), sf('s2', 'sim', 'por'),
    ]), declared);
    expect(rounds[0]!.matches.map((x) => x.id)).toEqual(['1', '4', '2', '3']);
    expect(rounds[1]!.matches.map((x) => x.id)).toEqual(['s1', 's2']);
    expect(slotFeeders(rounds, 2, 0)!.map((f) => f.kind === 'match' ? f.match.id : f.kind)).toEqual(['s1', 's2']);
  });

  it('sin rondas declaradas no inventa nada', () => {
    const rounds = completeBracket(buildBracketRounds([q('1', 'a', 'b'), q('2', 'c', 'd')]), []);
    expect(rounds.map((r) => [r.key, r.slots])).toEqual([['quarters', 2]]);
  });
});

describe('slotFeeders', () => {
  const q = (id: string, h: string, a: string, over: Partial<SeasonMatch> = {}) =>
    m(id, h, a, { stage: 'quarters', roundId: 'rq', roundName: '1/4 Final', status: 'scheduled', score: { home: null, away: null }, winnerTeamId: null, ...over } as Partial<SeasonMatch>);
  const declared = [
    { id: 'rs', number: 30, name: '1/2 Final', roundType: 'playoff' as const, stage: 'semis' as const },
    { id: 'rf', number: 40, name: 'Final', roundType: 'playoff' as const, stage: 'final' as const },
  ];
  const cols = completeBracket(buildBracketRounds([
    q('1', 'a', 'b', { status: 'finished', score: { home: 1, away: 3 }, winnerTeamId: 'b' } as Partial<SeasonMatch>),
    q('2', 'c', 'd'), q('3', 'e', 'f'), q('4', 'g', 'h'),
  ]), declared);

  it('semifinal 1: el que ya pasó y el cruce aún por jugar', () => {
    const f = slotFeeders(cols, 1, 0)!;
    expect(f[0]).toMatchObject({ kind: 'team', team: { id: 'b' } });
    expect(f[1]).toMatchObject({ kind: 'match', match: { id: '2' } });
  });

  it('final: ganadores de las dos semifinales por determinar', () => {
    const f = slotFeeders(cols, 2, 0)!;
    expect(f.map((x) => x.kind === 'slot' ? [x.round.key, x.index] : null)).toEqual([['semis', 0], ['semis', 1]]);
  });
});

import { describe, it, expect } from 'vitest';
import {
  isKnockoutSeason,
  buildKnockoutSummary,
  type KnockoutMatchInput,
} from './knockout';
import type { TeamSeasonInfo } from './api/types';

/**
 * Fixtures REALES de producción (API sticklive.eu, octubre 2026):
 *  - Supercopa M 2025/26 (final_four): 3 partidos, UNA ronda "FINAL" rn=4,
 *    sin winnerTeamId (ganador derivable del marcador).
 *  - Copa del Rey 2025/26 (bracket): rondas reales rn=1/2/3 con winnerTeamId.
 *  - OK Liga Bronce Eliminatoria 2025/26 (bracket): ida/vuelta sin rondas.
 *  - Supercopa "Histórico": partidos sin fecha ni rondas (datos insuficientes).
 *  - Supercopa 2026/27: semis programadas (ronda "SEMIFINALES" rn=1).
 */

const BAR = 'f67b2d80-127d-41cc-a7f8-f5b4dd821621';
const HCL = 'ccc49524-8422-4e3e-883c-c0067cec913c';
const IHC = '2040ff0e-80e8-4bce-8105-528fa3c1216d';
const REUS = '536b6256-6c34-47c5-814d-72aea7dbcecf';
const CAL = 'cal-id';
const NOIA = 'noia-id';

const finalFour: TeamSeasonInfo = {
  competitionId: 'c1',
  competitionSlug: 'supercopa-de-espana-masculina',
  competitionName: 'SUPERCOPA DE ESPAÑA MASCULINA',
  competitionShort: 'Supercopa',
  competitionFormat: 'final_four',
};
const bracket: TeamSeasonInfo = { ...finalFour, competitionFormat: 'bracket', competitionSlug: 'copa-del-rey' };
const league: TeamSeasonInfo = { ...finalFour, competitionFormat: 'league', competitionSlug: 'ok-liga-masculina' };

/** Equipo + rival con marcador; los ids de equipo mandan sobre el rol casa/fuera. */
function m(
  id: string,
  homeId: string,
  awayId: string,
  home: number | null,
  away: number | null,
  opts: Partial<KnockoutMatchInput> = {},
): KnockoutMatchInput {
  return {
    id,
    status: 'finished',
    scheduledAt: opts.scheduledAt ?? null,
    score: { home, away },
    homeTeam: { id: homeId, name: homeId, shortName: homeId.slice(0, 3), logoUrl: null },
    awayTeam: { id: awayId, name: awayId, shortName: awayId.slice(0, 3), logoUrl: null },
    ...opts,
  };
}

// ─── Supercopa 2025/26 (final_four, una única ronda rn=4 "FINAL") ──────────

const SUP_2526: KnockoutMatchInput[] = [
  m('s1', REUS, IHC, 3, 5, { scheduledAt: '2025-09-20T14:15:00Z' }),
  m('s2', BAR, HCL, 5, 2, { scheduledAt: '2025-09-20T16:45:00Z' }),
  m('s3', IHC, BAR, 1, 3, { scheduledAt: '2025-09-21T10:15:00Z' }),
];

describe('isKnockoutSeason', () => {
  it('formato declarado bracket/final_four → knockout', () => {
    expect(isKnockoutSeason(finalFour, null, SUP_2526)).toBe(true);
    expect(isKnockoutSeason(bracket, null, SUP_2526)).toBe(true);
  });

  it('formato league → no knockout (aunque no haya standing)', () => {
    expect(isKnockoutSeason(league, null, SUP_2526)).toBe(false);
  });

  it('fallback defensivo: sin formato declarado, sin standing y todos los partidos de eliminatoria', () => {
    const legacy = { ...league, competitionFormat: 'league' as const };
    const playoffMatches = SUP_2526.map((x) => ({ ...x, roundType: 'playoff' as const }));
    expect(isKnockoutSeason(legacy, null, playoffMatches)).toBe(true);
    // Con standing (liga) o con partidos regulares NO es knockout
    expect(isKnockoutSeason(legacy, { position: 1 }, playoffMatches)).toBe(false);
    expect(isKnockoutSeason(legacy, null, SUP_2526)).toBe(false);
  });

  it('sin temporada declarada y sin partidos → no knockout', () => {
    expect(isKnockoutSeason(null, null, [])).toBe(false);
  });
});

describe('buildKnockoutSummary · Supercopa 2025/26 (fases derivadas por cronología)', () => {
  it('BAR: campeón — ganó semifinal y final', () => {
    const s = buildKnockoutSummary(BAR, SUP_2526)!;
    expect(s).not.toBeNull();
    expect(s.incomplete).toBe(false);
    expect(s.champion).toBe(true);
    expect(s.eliminatedIn).toBeNull();
    expect(s.phases.map((p) => p.phase)).toEqual(['semis', 'final']);
    // Semifinal: vs HCL, ganada
    const semi = s.phases[0]!;
    expect(semi.series).toHaveLength(1);
    expect(semi.series[0]!.opponent.id).toBe(HCL);
    expect(semi.series[0]!.result).toBe('won');
    // Final: vs IHC (fuera), ganada
    const fin = s.phases[1]!;
    expect(fin.series[0]!.opponent.id).toBe(IHC);
    expect(fin.series[0]!.result).toBe('won');
    expect(fin.series[0]!.games[0]!.score).toEqual({ home: 1, away: 3 });
  });

  it('HCL: eliminado en semifinales (una sola eliminatoria, no es la final)', () => {
    const s = buildKnockoutSummary(HCL, SUP_2526)!;
    expect(s.champion).toBe(false);
    expect(s.eliminatedIn).toBe('semis');
    expect(s.phases.map((p) => p.phase)).toEqual(['semis']);
    expect(s.phases[0]!.series[0]!.result).toBe('lost');
    expect(s.phases[0]!.series[0]!.opponent.id).toBe(BAR);
  });

  it('expone fase por partido para etiquetar el calendario', () => {
    const s = buildKnockoutSummary(BAR, SUP_2526)!;
    expect(s.phaseByMatch.get('s2')?.phase).toBe('semis');
    expect(s.phaseByMatch.get('s3')?.phase).toBe('final');
  });
});

// ─── Copa del Rey 2025/26 (bracket, rondas reales rn=1/2/3) ────────────────

const CDR: KnockoutMatchInput[] = [
  m('q1', CAL, REUS, 4, 2, { scheduledAt: '2026-02-20T18:00:00Z', roundNumber: 1, roundId: 'r1', winnerTeamId: CAL }),
  m('q2', BAR, NOIA, 4, 0, { scheduledAt: '2026-02-20T20:30:00Z', roundNumber: 1, roundId: 'r1', winnerTeamId: BAR }),
  m('q3', IHC, 'cpv-id', 2, 1, { scheduledAt: '2026-02-21T17:00:00Z', roundNumber: 1, roundId: 'r1', winnerTeamId: IHC }),
  m('q4', HCL, 'pas-id', 2, 1, { scheduledAt: '2026-02-21T19:30:00Z', roundNumber: 1, roundId: 'r1', winnerTeamId: HCL }),
  m('sf1', CAL, BAR, 3, 3, { scheduledAt: '2026-03-14T18:00:00Z', roundNumber: 2, roundId: 'r2', winnerTeamId: CAL, winType: 'penalties' }),
  m('sf2', IHC, HCL, 1, 2, { scheduledAt: '2026-03-14T20:45:00Z', roundNumber: 2, roundId: 'r2', winnerTeamId: HCL }),
  m('f1', CAL, HCL, 1, 4, { scheduledAt: '2026-04-11T18:30:00Z', roundNumber: 3, roundId: 'r3', winnerTeamId: HCL }),
];

describe('buildKnockoutSummary · Copa del Rey (fases reales por roundNumber)', () => {
  it('HCL: campeón con cuartos → semis → final', () => {
    const s = buildKnockoutSummary(HCL, CDR)!;
    expect(s.champion).toBe(true);
    expect(s.eliminatedIn).toBeNull();
    expect(s.phases.map((p) => p.phase)).toEqual(['quarters', 'semis', 'final']);
    expect(s.phaseByMatch.get('f1')?.phase).toBe('final');
  });

  it('BAR: eliminado en semis (empató y cayó en penaltis)', () => {
    const s = buildKnockoutSummary(BAR, CDR)!;
    expect(s.champion).toBe(false);
    expect(s.eliminatedIn).toBe('semis');
    expect(s.phases.map((p) => p.phase)).toEqual(['quarters', 'semis']);
    const semi = s.phases[1]!.series[0]!;
    expect(semi.result).toBe('lost');
    expect(semi.decidedBy).toBe('penalties');
    // Cuartos ganados a NOIA
    expect(s.phases[0]!.series[0]!.result).toBe('won');
    expect(s.phases[0]!.series[0]!.opponent.id).toBe(NOIA);
  });
});

// ─── OK Liga Bronce Eliminatoria (bracket, ida/vuelta sin rondas) ──────────

const BRONCE: KnockoutMatchInput[] = [
  m('b1', 'alu-id', 'lub-id', 2, 2, { scheduledAt: '2026-05-30T17:00:00Z' }),
  m('b2', 'lub-id', 'alu-id', 4, 3, { scheduledAt: '2026-06-06T17:00:00Z' }),
];

describe('buildKnockoutSummary · ida y vuelta sin rondas', () => {
  it('una sola eliminatoria (2 partidos) decidida por el conjunto: LUB campeón', () => {
    const s = buildKnockoutSummary('lub-id', BRONCE)!;
    expect(s.champion).toBe(true);
    expect(s.phases).toHaveLength(1);
    expect(s.phases[0]!.phase).toBe('final');
    const serie = s.phases[0]!.series[0]!;
    expect(serie.games).toHaveLength(2);
    expect(serie.winsFor).toBe(1);
    expect(serie.winsAgainst).toBe(0);
    expect(serie.result).toBe('won');
  });

  it('ALU eliminado en la misma eliminatoria', () => {
    const s = buildKnockoutSummary('alu-id', BRONCE)!;
    expect(s.champion).toBe(false);
    expect(s.eliminatedIn).toBe('final');
    expect(s.phases[0]!.series[0]!.result).toBe('lost');
  });
});

// ─── Supercopa 2026/27 (semis programadas) ─────────────────────────────────

const SUP_2627: KnockoutMatchInput[] = [
  m('n1', HCL, BAR, null, null, { status: 'scheduled', scheduledAt: '2026-10-24T00:00:00Z', roundNumber: 1, roundId: 'n1', roundName: 'SEMIFINALES' }),
  m('n2', IHC, 'cal-id', null, null, { status: 'scheduled', scheduledAt: '2026-10-24T00:00:00Z', roundNumber: 1, roundId: 'n1', roundName: 'SEMIFINALES' }),
];

describe('buildKnockoutSummary · eliminatoria en curso', () => {
  it('BAR: semifinal pendiente — sin campeón, sin eliminación', () => {
    const s = buildKnockoutSummary(BAR, SUP_2627)!;
    expect(s.champion).toBe(false);
    expect(s.eliminatedIn).toBeNull();
    expect(s.phases).toHaveLength(1);
    expect(s.phases[0]!.series[0]!.result).toBe('open');
  });
});

// ─── World Skate: rondas nombradas con 3.er/4.º puesto ─────────────────────

const WS: KnockoutMatchInput[] = [
  m('w1', BAR, 'a-id', 3, 1, { scheduledAt: '2026-05-01T10:00:00Z', roundId: 'wq', roundNumber: 1, roundName: 'Quarterfinals', winnerTeamId: BAR }),
  m('w2', 'b-id', 'c-id', 2, 1, { scheduledAt: '2026-05-01T12:30:00Z', roundId: 'wq', roundNumber: 1, roundName: 'Quarterfinals', winnerTeamId: 'b-id' }),
  m('w3', BAR, 'b-id', 2, 2, { scheduledAt: '2026-05-02T10:00:00Z', roundId: 'ws', roundNumber: 2, roundName: 'Semifinals', winnerTeamId: 'b-id', winType: 'penalties' }),
  m('w4', BAR, 'c-id', 4, 2, { scheduledAt: '2026-05-03T10:00:00Z', roundId: 'w3', roundNumber: 3, roundName: '3rd Place', winnerTeamId: BAR }),
  m('w5', 'b-id', 'd-id', 1, 0, { scheduledAt: '2026-05-03T12:30:00Z', roundId: 'wf', roundNumber: 4, roundName: 'Final', winnerTeamId: 'b-id' }),
];

describe('buildKnockoutSummary · 3.er y 4.º puesto', () => {
  it('BAR: cae en semis, gana el 3.er puesto — eliminado en semis, nunca campeón', () => {
    const s = buildKnockoutSummary(BAR, WS)!;
    expect(s.champion).toBe(false);
    expect(s.eliminatedIn).toBe('semis');
    expect(s.phases.map((p) => p.phase)).toEqual(['quarters', 'semis', null]);
    // La fase sin clave canónica conserva el nombre propio de la ronda
    expect(s.phases[2]!.roundName).toBe('3rd Place');
    expect(s.phases[2]!.series[0]!.result).toBe('won');
  });
});

// ─── Copa del Rey REAL: una sola ronda 'FINAL' con las 7 eliminatorias ─────
// (producción: la fuente no distingue fases; el ganador se deriva del cuadro)

const CDR_SINGLE_ROUND: KnockoutMatchInput[] = [
  m('c1', CAL, REUS, 4, 2, { scheduledAt: '2026-02-20T18:00:00Z', roundId: 'r-all', roundName: 'FINAL', winnerTeamId: CAL }),
  m('c2', BAR, NOIA, 4, 0, { scheduledAt: '2026-02-20T20:30:00Z', roundId: 'r-all', roundName: 'FINAL', winnerTeamId: BAR }),
  m('c3', IHC, 'cpv-id', 2, 1, { scheduledAt: '2026-02-21T17:00:00Z', roundId: 'r-all', roundName: 'FINAL', winnerTeamId: IHC }),
  m('c4', HCL, 'pas-id', 2, 1, { scheduledAt: '2026-02-21T19:30:00Z', roundId: 'r-all', roundName: 'FINAL', winnerTeamId: HCL }),
  m('c5', CAL, BAR, 3, 3, { scheduledAt: '2026-03-14T18:00:00Z', roundId: 'r-all', roundName: 'FINAL', winnerTeamId: CAL, winType: 'penalties' }),
  m('c6', IHC, HCL, 1, 2, { scheduledAt: '2026-03-14T20:45:00Z', roundId: 'r-all', roundName: 'FINAL', winnerTeamId: HCL }),
  m('c7', CAL, HCL, 1, 4, { scheduledAt: '2026-04-11T18:30:00Z', roundId: 'r-all', roundName: 'FINAL', winnerTeamId: HCL }),
];

describe('buildKnockoutSummary · Copa del Rey real (una ronda, cuadro de 8)', () => {
  it('deriva cuartos/semis/final por cronología y corona a HCL', () => {
    const s = buildKnockoutSummary(HCL, CDR_SINGLE_ROUND)!;
    expect(s.incomplete).toBe(false);
    expect(s.champion).toBe(true);
    expect(s.phases.map((p) => p.phase)).toEqual(['quarters', 'semis', 'final']);
  });

  it('BAR: eliminado en semis (penaltis)', () => {
    const s = buildKnockoutSummary(BAR, CDR_SINGLE_ROUND)!;
    expect(s.eliminatedIn).toBe('semis');
    expect(s.phases[1]!.series[0]!.decidedBy).toBe('penalties');
  });
});

// ─── Bucket histórico FECHADO con varias ediciones mezcladas ───────────────

const MIXED_DATED: KnockoutMatchInput[] = [
  // Edición antigua: otra "final" cuyo ganador no reaparece después
  m('x1', 'old-a', 'old-b', 3, 1, { scheduledAt: '2016-09-20T16:00:00Z', winnerTeamId: 'old-a' }),
  m('x2', 'old-c', 'old-d', 2, 0, { scheduledAt: '2016-09-20T18:00:00Z', winnerTeamId: 'old-c' }),
  m('x3', 'old-a', 'old-c', 1, 2, { scheduledAt: '2016-09-21T10:00:00Z', winnerTeamId: 'old-c' }),
  // Edición actual: la Supercopa real
  ...SUP_2526,
];

describe('buildKnockoutSummary · bucket mezclado con fechas', () => {
  it('cada edición rompe la cadena del cuadro → modo conservador', () => {
    const s = buildKnockoutSummary(BAR, MIXED_DATED)!;
    expect(s.incomplete).toBe(true);
    expect(s.phases).toEqual([]);
    expect(s.champion).toBe(false);
  });
});

// ─── Supercopa "Histórico" (sin fechas ni rondas → datos insuficientes) ────

const HISTORICO: KnockoutMatchInput[] = [
  m('h1', BAR, 'reus-id', 5, 3),
  m('h2', 'lice-id', BAR, 7, 6),
  m('h3', BAR, 'noia-id', 11, 1),
];

describe('buildKnockoutSummary · datos insuficientes', () => {
  it('sin fechas ni rondas: modo conservador, sin fases inventadas ni campeón', () => {
    const s = buildKnockoutSummary(BAR, HISTORICO)!;
    expect(s.incomplete).toBe(true);
    expect(s.champion).toBe(false);
    expect(s.phases).toEqual([]);
    expect(s.matches).toHaveLength(3); // lista simple de partidos registrados
  });

  it('sin partidos → null (el llamante muestra el estado vacío)', () => {
    expect(buildKnockoutSummary(BAR, [])).toBeNull();
  });

  it('eliminatoria en juego: la final no corona a nadie todavía', () => {
    const live: KnockoutMatchInput[] = [
      m('l1', BAR, HCL, 5, 2, { scheduledAt: '2026-09-20T16:45:00Z' }),
      m('l2', IHC, BAR, 1, 1, { status: 'live', scheduledAt: '2026-09-21T10:15:00Z' }),
    ];
    const s = buildKnockoutSummary(BAR, live)!;
    expect(s.champion).toBe(false);
    expect(s.eliminatedIn).toBeNull();
    expect(s.phases[1]!.series[0]!.result).toBe('open');
  });
});

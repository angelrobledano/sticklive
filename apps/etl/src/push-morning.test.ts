import { describe, it, expect } from 'vitest';
import { morningMatchesFor, type MorningNightMatch, type SubPrefs } from './push-segmentation.js';

/** Suscripción mínima para la segmentación (mismos defaults que el resto). */
function sub(over: Partial<SubPrefs> = {}): SubPrefs {
  return { fav_teams: [], fav_leagues: [], fav_players: [], presets: {}, ...over };
}

/** Partido nocturno candidato al resumen matinal. */
function night(over: Partial<MorningNightMatch> = {}): MorningNightMatch {
  return { matchId: 'm1', homeTeamId: 'T1', awayTeamId: 'T2', competitionId: 'C1', ...over };
}

describe('morningMatchesFor — qué partidos van en el resumen matinal de una suscripción', () => {
  it('incluye el partido si sigue a cualquiera de los dos equipos', () => {
    expect(morningMatchesFor(sub({ fav_teams: ['T1'] }), [night()])).toHaveLength(1);
    expect(morningMatchesFor(sub({ fav_teams: ['T2'] }), [night()])).toHaveLength(1);
  });

  it('incluye el partido si sigue la competición', () => {
    expect(morningMatchesFor(sub({ fav_leagues: ['C1'] }), [night()])).toHaveLength(1);
  });

  it('excluye el partido si no sigue ninguna entidad relacionada (no spam)', () => {
    expect(morningMatchesFor(sub({ fav_teams: ['T9'] }), [night()])).toEqual([]);
    expect(morningMatchesFor(sub(), [night()])).toEqual([]);
  });

  it('un seguidor solo de jugador NO recibe el resumen (el final no lleva jugador)', () => {
    expect(morningMatchesFor(sub({ fav_players: ['P1'] }), [night()])).toEqual([]);
  });

  it("respeta el preset por entidad: 'silent' no recibe y 'results' sí", () => {
    const silent = sub({ fav_teams: ['T1'], presets: { 'team:T1': 'silent' } });
    expect(morningMatchesFor(silent, [night()])).toEqual([]);

    const results = sub({ fav_teams: ['T1'], presets: { 'team:T1': 'results' } });
    expect(morningMatchesFor(results, [night()])).toHaveLength(1);
  });

  it('no duplica un partido aunque aparezca dos veces (mismo matchId → una entrada)', () => {
    const twice = [night({ matchId: 'm1' }), night({ matchId: 'm1', competitionId: 'C2' })];
    expect(morningMatchesFor(sub({ fav_teams: ['T1'] }), twice)).toHaveLength(1);
  });

  it('devuelve todos los partidos que le tocan, conservando el orden', () => {
    const list = [
      night({ matchId: 'm1', homeTeamId: 'T1' }),
      night({ matchId: 'm2', homeTeamId: 'T3', awayTeamId: 'T4', competitionId: 'C9' }), // no le toca
      night({ matchId: 'm3', competitionId: 'C1' }),
    ];
    expect(morningMatchesFor(sub({ fav_teams: ['T1'], fav_leagues: ['C1'] }), list).map((m) => m.matchId))
      .toEqual(['m1', 'm3']);
  });

  it('conserva los campos extra del candidato (para construir el copy)', () => {
    const candidate = { ...night(), homeShort: 'BAR', awayShort: 'IHC', homeScore: 3, awayScore: 1 };
    const out = morningMatchesFor(sub({ fav_teams: ['T1'] }), [candidate]);
    expect(out[0]).toMatchObject({ matchId: 'm1', homeShort: 'BAR', awayScore: 1 });
  });
});

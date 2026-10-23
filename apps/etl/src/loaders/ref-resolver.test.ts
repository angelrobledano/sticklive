import { describe, it, expect } from 'vitest';

// `@sports/db` exige DATABASE_URL al importarse (el pool no conecta al importar).
process.env['DATABASE_URL'] ??= 'postgres://localhost:5432/test';

const { pickUnambiguousTeam, signalsConflict, isReviewableName } = await import('./ref-resolver.js');

/**
 * #228: el puente `source_ref`/`alt_source_refs` es global (sin namespacing por
 * portal), así que una ref puede designar 2-3 equipos. Resolver "la primera" es
 * resolver el equipo equivocado a ciegas; en ambiguo se sigue la cascada.
 */
describe('pickUnambiguousTeam (#228)', () => {
  it('0 candidatos → ninguno (no ambiguo)', () => {
    expect(pickUnambiguousTeam([])).toEqual({ team: null, ambiguous: false });
  });

  it('1 candidato → ese equipo', () => {
    expect(pickUnambiguousTeam([{ id: 'a' }])).toEqual({ team: { id: 'a' }, ambiguous: false });
  });

  it('>1 candidatos → ambiguo, sin coger la primera', () => {
    const r = pickUnambiguousTeam([{ id: 'a' }, { id: 'b' }]);
    expect(r.team).toBeNull();
    expect(r.ambiguous).toBe(true);
  });
});

/**
 * #194 — género/categoría son más discriminantes que el nombre. El resolver
 * debe descartar cualquier candidato que contradiga las señales de la
 * competición, venga del mapa, del slug o de un alias.
 */
describe('signalsConflict (#194)', () => {
  const team = (over: Record<string, unknown> = {}) =>
    ({ gender: 'female', age_category: 'senior', ...over }) as never;

  it('sin señales no hay conflicto', () => {
    expect(signalsConflict(team(), undefined)).toBe(false);
  });

  it('mismo género y categoría no es conflicto', () => {
    expect(signalsConflict(team(), { gender: 'female', ageCategory: 'senior' })).toBe(false);
  });

  it('género contrario es conflicto', () => {
    expect(signalsConflict(team(), { gender: 'male', ageCategory: 'senior' })).toBe(true);
  });

  it('categoría contraria es conflicto', () => {
    expect(signalsConflict(team(), { gender: 'female', ageCategory: 'juvenil' })).toBe(true);
  });

  it('NULL en cualquiera de los dos lados no bloquea (legado sin clasificar)', () => {
    expect(signalsConflict(team({ gender: null }), { gender: 'male' })).toBe(false);
    expect(signalsConflict(team(), { gender: null })).toBe(false);
  });
});

/**
 * La cola HITL es para NOMBRES ("CP VILANOVA A"): un humano no puede saber qué
 * equipo es «fep_club_102» o «11846», y el buscador no da candidatos. Las refs
 * de club van por source_club_map y las de inscripción, por el scraper de equipos.
 */
describe('isReviewableName (cola HITL)', () => {
  it.each(['fep_club_102', 'fep_club_calafell', '11846', 'wse_1130', '3019'])('%s es un id → no se encola', (r) => {
    expect(isReviewableName(r)).toBe(false);
  });
  it.each(['UNIKAL HC RAXOI', 'CP VILANOVA A', 'CH Mataró'])('%s es un nombre → se encola', (r) => {
    expect(isReviewableName(r)).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';

// `@sports/db` exige DATABASE_URL al importarse (el pool no conecta al importar).
process.env['DATABASE_URL'] ??= 'postgres://localhost:5432/test';

const { pickUnambiguousTeam } = await import('./ref-resolver.js');

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

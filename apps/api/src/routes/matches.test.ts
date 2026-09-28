import { describe, it, expect } from 'vitest';

// `@sports/db` exige DATABASE_URL al importarse (aunque el pool no conecta hasta
// la primera query). Fijamos una de mentira ANTES del import dinámico para poder
// testear la lógica pura de la ruta sin levantar Postgres.
process.env['DATABASE_URL'] ??= 'postgres://localhost:5432/test';

const { parseGameweek, parseTeamId } = await import('./matches.js');

/**
 * #333: `?gameweek=3abc` devolvía 200 con jornada 3 (parseInt parcial). Ahora
 * un valor no entero o < 1 debe rechazarse con 400.
 */
describe('parseGameweek', () => {
  it('sin parámetro → undefined (no filtra)', () => {
    expect(parseGameweek(undefined)).toBeUndefined();
  });

  it('acepta enteros positivos', () => {
    expect(parseGameweek('1')).toBe(1);
    expect(parseGameweek('12')).toBe(12);
    expect(parseGameweek('007')).toBe(7);
  });

  it('rechaza parciales numéricos (antes colaban por parseInt)', () => {
    expect(parseGameweek('3abc')).toBeNull();
    expect(parseGameweek('1.5')).toBeNull();
    expect(parseGameweek(' 3')).toBeNull();
    expect(parseGameweek('3 ')).toBeNull();
  });

  it('rechaza cero, negativos y cadenas no numéricas', () => {
    expect(parseGameweek('0')).toBeNull();
    expect(parseGameweek('-1')).toBeNull();
    expect(parseGameweek('')).toBeNull();
    expect(parseGameweek('abc')).toBeNull();
  });
});

/**
 * #321: `?teamId=xyz` llegaba al cast a uuid de Postgres y devolvía 500. Un
 * teamId malformado debe rechazarse con 400 sin tocar la BD.
 */
describe('parseTeamId', () => {
  it('sin parámetro → undefined (no filtra)', () => {
    expect(parseTeamId(undefined)).toBeUndefined();
  });

  it('acepta un UUID válido', () => {
    const id = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
    expect(parseTeamId(id)).toBe(id);
  });

  it('rechaza ids que no son UUID (null → 400)', () => {
    for (const bad of ['xyz', '123', '', 'not-a-uuid', '3f2504e0-4f89-41d3-9a0c-0305e82c330']) {
      expect(parseTeamId(bad), bad).toBeNull();
    }
  });
});

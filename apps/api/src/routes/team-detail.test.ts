import { describe, it, expect } from 'vitest';

// `@sports/db` exige DATABASE_URL al importarse (el pool no conecta al importar).
process.env['DATABASE_URL'] ??= 'postgres://localhost:5432/test';

const { resolveSelectedSeason } = await import('./team-detail.js');

/**
 * Selector de temporada de la ficha de equipo: la pedida manda si el equipo
 * participa en ella; si no, la primera (que ya viene con la actual primero).
 */
describe('resolveSelectedSeason', () => {
  const seasons = [{ id: 's2' }, { id: 's1' }]; // orden real: actual primero

  it('usa la temporada pedida si el equipo participa en ella', () => {
    expect(resolveSelectedSeason('s1', seasons)).toBe('s1');
    expect(resolveSelectedSeason('s2', seasons)).toBe('s2');
  });

  it('cae a la primera (actual) si la pedida no es del equipo', () => {
    expect(resolveSelectedSeason('otra', seasons)).toBe('s2');
  });

  it('cae a la primera si no se pide ninguna', () => {
    expect(resolveSelectedSeason(null, seasons)).toBe('s2');
  });

  it('sin temporadas devuelve null (no rompe)', () => {
    expect(resolveSelectedSeason('s1', [])).toBeNull();
    expect(resolveSelectedSeason(null, [])).toBeNull();
  });
});

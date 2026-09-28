import { describe, it, expect } from 'vitest';
import { competitionTabFromParam } from './CompetitionClient';

/**
 * #352: el tab principal de la competición viaja en la URL (?tab=) sin pisar
 * los sub-filtros existentes (?journey/?date/?team_id/?phase).
 */
const VISIBLE = ['Clasificación', 'Jornadas', 'Playoffs', 'Estadísticas'] as const;

describe('competitionTabFromParam (#352)', () => {
  it('mapea los slugs canónicos de la URL a su tab', () => {
    expect(competitionTabFromParam('standing', VISIBLE)).toBe('Clasificación');
    expect(competitionTabFromParam('fixtures', VISIBLE)).toBe('Jornadas');
    expect(competitionTabFromParam('playoffs', VISIBLE)).toBe('Playoffs');
    expect(competitionTabFromParam('stats', VISIBLE)).toBe('Estadísticas');
  });

  it('sin parámetro no impone tab (se usa el defecto)', () => {
    expect(competitionTabFromParam(null, VISIBLE)).toBeNull();
    expect(competitionTabFromParam('', VISIBLE)).toBeNull();
  });

  it('ignora un valor desconocido', () => {
    expect(competitionTabFromParam('basura', VISIBLE)).toBeNull();
    expect(competitionTabFromParam('Standing', VISIBLE)).toBeNull();
  });

  it('ignora una tab válida que no está visible en esta competición', () => {
    expect(competitionTabFromParam('playoffs', ['Clasificación', 'Jornadas'])).toBeNull();
  });
});

import { describe, it, expect } from 'vitest';
import { isGenericStandingsTitle } from './fep-standings.scraper.js';

/**
 * El scraper tomaba el título de la cabecera como nombre de grupo. El título
 * genérico "CLASIFICACIÓN" se colaba porque el filtro comparaba sin normalizar
 * tildes, y la web pintaba "Grupo CLASIFICACIÓN" perdiendo las zonas de
 * playoff/descenso. `isGenericStandingsTitle` reconoce esos títulos genéricos.
 */
describe('isGenericStandingsTitle', () => {
  it('reconoce el título genérico aunque lleve tilde o minúsculas', () => {
    expect(isGenericStandingsTitle('CLASIFICACIÓN')).toBe(true);
    expect(isGenericStandingsTitle('Clasificación')).toBe(true);
    expect(isGenericStandingsTitle('CLASIFICACION')).toBe(true);
    expect(isGenericStandingsTitle('  clasificación  ')).toBe(true);
  });

  it('reconoce variantes en catalán e inglés', () => {
    expect(isGenericStandingsTitle('Classificació')).toBe(true);
    expect(isGenericStandingsTitle('Standings')).toBe(true);
    expect(isGenericStandingsTitle('Classification')).toBe(true);
  });

  it('NO marca como genérico un grupo real', () => {
    expect(isGenericStandingsTitle('GRUPO A')).toBe(false);
    expect(isGenericStandingsTitle('Grupo B')).toBe(false);
    expect(isGenericStandingsTitle('Fase final')).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import { isGenericStandingsTitle, parseGroupTitle } from './standings-title.js';

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

describe('parseGroupTitle — grupo de la cabecera de una tabla', () => {
  it('extrae la etiqueta del grupo (FECAPA concatena etiquetas de idioma)', () => {
    expect(parseGroupTitle('GRUPOGIRONEGROUP GRUP A')).toBe('A');
    expect(parseGroupTitle('GRUPO GRUP B')).toBe('B');
    expect(parseGroupTitle('GRUP C')).toBe('C');
    expect(parseGroupTitle('GROUP A')).toBe('A');
  });

  it('admite nombres de grupo cortos', () => {
    expect(parseGroupTitle('GRUPO NORTE')).toBe('NORTE');
  });

  it('no confunde un título de fase con un grupo', () => {
    expect(parseGroupTitle('FASE DE GRUPS FRIT RAVICH LLIGA CATALANA')).toBeUndefined();
    expect(parseGroupTitle('FASES FINALS FRIT RAVICH LLIGA CATALANA')).toBeUndefined();
    expect(parseGroupTitle('GROUP PHASE')).toBeUndefined();
    expect(parseGroupTitle('CLASIFICACIÓN')).toBeUndefined();
  });
});

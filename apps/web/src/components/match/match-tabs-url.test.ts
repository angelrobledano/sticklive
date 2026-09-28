import { describe, it, expect } from 'vitest';
import { matchTabFromParam } from './MatchCenterClient';

/**
 * #352: el tab activo del partido viaja en la URL (?tab=). Esta función pura
 * decide qué tab pedir a partir del parámetro y de las tabs realmente visibles
 * (nunca hay que mostrar una pestaña vacía).
 */
const VISIBLE = ['Resumen', 'Alineaciones', 'Estadísticas'] as const;

describe('matchTabFromParam (#352)', () => {
  it('mapea los slugs canónicos de la URL a su tab', () => {
    expect(matchTabFromParam('summary', VISIBLE)).toBe('Resumen');
    expect(matchTabFromParam('lineups', VISIBLE)).toBe('Alineaciones');
    expect(matchTabFromParam('stats', VISIBLE)).toBe('Estadísticas');
  });

  it('sin parámetro no impone tab (se usa el defecto)', () => {
    expect(matchTabFromParam(null, VISIBLE)).toBeNull();
    expect(matchTabFromParam('', VISIBLE)).toBeNull();
  });

  it('ignora un valor desconocido en vez de romper', () => {
    expect(matchTabFromParam('basura', VISIBLE)).toBeNull();
    expect(matchTabFromParam('Stats', VISIBLE)).toBeNull();
    expect(matchTabFromParam('estadísticas', VISIBLE)).toBeNull();
  });

  it('ignora una tab válida que no está visible en este partido', () => {
    expect(matchTabFromParam('lineups', ['Resumen'])).toBeNull();
    expect(matchTabFromParam('stats', ['Resumen'])).toBeNull();
    expect(matchTabFromParam('summary', [])).toBeNull();
  });
});

import { describe, it, expect } from 'vitest';
import { sourceForMatchRef, resolveMatchSourceIds } from './sources.js';

/**
 * Registro multi-fuente de sidgad (#333): la resolución por prefijo es la
 * puerta de las fichas. Estos casos fijan el contrato para FEP y World Skate
 * (Europe + World Skate Games comparten el portal 'worldskate').
 */
describe('sourceForMatchRef', () => {
  it('resuelve FEP y World Skate por prefijo', () => {
    expect(sourceForMatchRef('fep_match_34259')?.key).toBe('fep');
    expect(sourceForMatchRef('wse_match_3163')?.key).toBe('wse');
  });

  it('devuelve null para refs desconocidos o vacíos', () => {
    expect(sourceForMatchRef('xyz_match_1')).toBeNull();
    expect(sourceForMatchRef(null)).toBeNull();
    expect(sourceForMatchRef(undefined)).toBeNull();
  });
});

describe('resolveMatchSourceIds', () => {
  it('FEP: extrae idp del ref de partido e idc del ref de competición', () => {
    const r = resolveMatchSourceIds('fep_match_34259', 'fep_competition_3150');
    expect(r?.source.key).toBe('fep');
    expect(r?.idp).toBe('34259');
    expect(r?.idc).toBe('3150');
  });

  it('World Skate (WSG ASU26): refs wse_match_/wse_competition_', () => {
    const r = resolveMatchSourceIds('wse_match_3163', 'wse_competition_329');
    expect(r?.source.key).toBe('wse');
    expect(r?.idp).toBe('3163');
    expect(r?.idc).toBe('329');
  });

  it('tolera un comp_ref ya limpio (sin prefijo)', () => {
    const r = resolveMatchSourceIds('wse_match_3163', '329');
    expect(r?.idc).toBe('329');
  });

  it('comp_ref vacío → idc vacío (el llamante decide si omite)', () => {
    const r = resolveMatchSourceIds('fep_match_34259', null);
    expect(r?.idp).toBe('34259');
    expect(r?.idc).toBe('');
  });

  it('fuente desconocida → null (el llamante omite con aviso, #333)', () => {
    expect(resolveMatchSourceIds('xyz_match_1', 'xyz_competition_1')).toBeNull();
  });
});

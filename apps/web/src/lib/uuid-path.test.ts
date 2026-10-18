import { describe, expect, it } from 'vitest';
import { lowercaseUuidPath } from './uuid-path';

describe('lowercaseUuidPath (F2-4)', () => {
  it('pasa a minúsculas un UUID en mayúsculas', () => {
    expect(lowercaseUuidPath('/es/teams/FA1575FB-4093-4180-BBED-AA2257219817')).toBe(
      '/es/teams/fa1575fb-4093-4180-bbed-aa2257219817',
    );
  });

  it('no toca un UUID que ya está en minúsculas', () => {
    const path = '/en/matches/fa1575fb-4093-4180-bbed-aa2257219817';
    expect(lowercaseUuidPath(path)).toBe(path);
  });

  it('no toca rutas que no son UUID', () => {
    expect(lowercaseUuidPath('/es/teams/CP-TORDERA')).toBe('/es/teams/CP-TORDERA');
    expect(lowercaseUuidPath('/es/competitions')).toBe('/es/competitions');
  });

  it('normaliza también UUIDs seguidos de un subrecurso', () => {
    expect(lowercaseUuidPath('/es/matches/FA1575FB-4093-4180-BBED-AA2257219817/lineup-image')).toBe(
      '/es/matches/fa1575fb-4093-4180-bbed-aa2257219817/lineup-image',
    );
  });
});

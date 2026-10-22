import { describe, it, expect } from 'vitest';
import {
  sourceForMatchRef, resolveMatchSourceIds, sourceForPortal, playerPrefix,
  matchRef, competitionRef, currentSource, playerIdFromRef, clubRef, isClubRef, competitionSourceRefForSeed,
} from './sources.js';

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

/**
 * Espacio de nombres por portal (A1). Cada portal sidgad tiene su propia
 * numeración de jugadores, partidos y competiciones: la ref tiene que llevar
 * el portal o dos entidades distintas comparten fila.
 */
describe('fuentes por portal (A1)', () => {
  it('cada portal autonómico tiene su propia fuente', () => {
    expect(sourceForPortal('fecapa').key).toBe('fecapa');
    expect(sourceForPortal('fmp').key).toBe('fmp');
    expect(sourceForPortal('rfep').key).toBe('fep');
    expect(sourceForPortal('worldskate').key).toBe('wse');
  });

  it('un portal desconocido es un error, no un fallback silencioso a RFEP', () => {
    expect(() => sourceForPortal('nadie')).toThrow(/portal/i);
  });

  it('prefijo de jugador: fep_ conservado para RFEP, el del portal para el resto', () => {
    expect(playerPrefix(sourceForPortal('rfep'))).toBe('fep_player_');
    expect(playerPrefix(sourceForPortal('fecapa'))).toBe('fecapa_player_');
    expect(playerPrefix(sourceForPortal('worldskate'))).toBe('wse_player_');
  });

  it('las refs de partido y competición de FECAPA llevan su portal', () => {
    const fecapa = sourceForPortal('fecapa');
    expect(matchRef(fecapa, '164291')).toBe('fecapa_match_164291');
    expect(competitionRef(fecapa, '4858')).toBe('fecapa_competition_4858');
    expect(sourceForMatchRef('fecapa_match_164291')?.key).toBe('fecapa');
    expect(resolveMatchSourceIds('fecapa_match_164291', 'fecapa_competition_4858'))
      .toMatchObject({ idp: '164291', idc: '4858' });
  });

  it('el portal activo sale de SIDGAD_PORTAL (rfep por defecto)', () => {
    expect(currentSource({}).key).toBe('fep');
    expect(currentSource({ SIDGAD_PORTAL: 'fecapa' }).key).toBe('fecapa');
  });

  it('el id numérico de una ref de jugador se extrae para cualquier portal', () => {
    expect(playerIdFromRef('fep_player_4095')).toEqual({ sourceKey: 'fep', id: '4095' });
    expect(playerIdFromRef('fecapa_player_14782')).toEqual({ sourceKey: 'fecapa', id: '14782' });
    expect(playerIdFromRef('basura')).toBeNull();
  });
});

describe('refs de club por portal (A1/A4)', () => {
  it('RFEP conserva fep_club_, el resto lleva su portal', () => {
    expect(clubRef(sourceForPortal('rfep'), '69')).toBe('fep_club_69');
    expect(clubRef(sourceForPortal('fecapa'), '322')).toBe('fecapa_club_322');
  });
  it('reconoce una ref de club de cualquier portal', () => {
    expect(isClubRef('fep_club_69')).toBe(true);
    expect(isClubRef('fecapa_club_322')).toBe(true);
    expect(isClubRef('3408')).toBe(false);
  });
});

describe('competitionSourceRefForSeed (A1)', () => {
  it('RFEP conserva el idc tal cual (lo ya sembrado), el resto lleva portal', () => {
    expect(competitionSourceRefForSeed(sourceForPortal('rfep'), '3150')).toBe('3150');
    expect(competitionSourceRefForSeed(sourceForPortal('fecapa'), '4858')).toBe('fecapa_competition_4858');
  });
});

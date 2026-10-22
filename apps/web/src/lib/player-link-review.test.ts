import { describe, it, expect } from 'vitest';
import { portalLabels, seasonConflicts, type ReviewSide } from './player-link-review';

/**
 * Panel B1 (/admin/jugadores): ayudas para decidir si dos fichas son la misma
 * persona. La decisión es humana; esto solo resalta señales.
 */
const lado = (refs: string[], teams: ReviewSide['teams']): ReviewSide => ({ refs, teams });

describe('portalLabels', () => {
  it('nombra la federación de cada ref', () => {
    expect(portalLabels(['fep_player_4095', 'fecapa_player_14782', 'wse_player_3801']))
      .toEqual(['RFEP', 'FECAPA', 'World Skate']);
  });
  it('una ref desconocida se muestra tal cual', () => {
    expect(portalLabels(['xyz_player_1'])).toEqual(['xyz']);
  });
});

describe('seasonConflicts', () => {
  it('misma temporada, equipos distintos en competiciones distintas no es conflicto (club y selección, o liga y copa)', () => {
    const a = lado([], [{ team: 'CALAFELL', season: '2026/27', competition: 'OK LIGA MASCULINA' }]);
    const b = lado([], [{ team: 'CALAFELL LA MENORQUINA', season: '2026/27', competition: 'LLIGA CATALANA MASCULINA' }]);
    expect(seasonConflicts(a, b)).toEqual([]);
  });
  it('misma temporada y misma competición con equipos distintos: conflicto (dos personas)', () => {
    const a = lado([], [{ team: 'CALDES', season: '2025/26', competition: 'OK LIGA MASCULINA' }]);
    const b = lado([], [{ team: 'BARÇA', season: '2025/26', competition: 'OK LIGA MASCULINA' }]);
    expect(seasonConflicts(a, b)).toEqual([{ season: '2025/26', competition: 'OK LIGA MASCULINA', teamA: 'CALDES', teamB: 'BARÇA' }]);
  });
  it('mismo equipo en la misma competición no es conflicto', () => {
    const t = [{ team: 'BARÇA', season: '2025/26', competition: 'OK LIGA MASCULINA' }];
    expect(seasonConflicts(lado([], t), lado([], t))).toEqual([]);
  });
});

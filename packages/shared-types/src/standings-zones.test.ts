import { describe, it, expect } from 'vitest';
import { zoneForPosition, type StandingsZone } from './standings-zones.js';

/**
 * B2 — reglamento como datos. Las zonas se declaran por temporada (y fase y
 * grupo) con su fuente normativa, no por regex sobre el nombre como OKMob.
 * Ejemplo: Nacional Catalana Masculina 26/27 (Especificacions § 2.4.1–2.4.2).
 */
const NCAT: StandingsZone[] = [
  { kind: 'champion', posFrom: 1, posTo: 1, target: null, phaseId: null, groupName: null },
  { kind: 'promotion_playoff', posFrom: 1, posTo: 4, target: 'OK Liga Plata', phaseId: null, groupName: null },
  { kind: 'playout', posFrom: 13, posTo: 14, target: 'Nacional Catalana Argent', phaseId: null, groupName: null },
  { kind: 'relegation', posFrom: 15, posTo: 16, target: 'Nacional Catalana Argent', phaseId: null, groupName: null },
];

describe('zoneForPosition', () => {
  it('devuelve la zona de la posición; con solape gana la más específica (rango más corto)', () => {
    expect(zoneForPosition(NCAT, 1)).toMatchObject({ kind: 'champion' });
    expect(zoneForPosition(NCAT, 3)).toMatchObject({ kind: 'promotion_playoff', target: 'OK Liga Plata' });
    expect(zoneForPosition(NCAT, 14)).toMatchObject({ kind: 'playout' });
    expect(zoneForPosition(NCAT, 16)).toMatchObject({ kind: 'relegation' });
  });
  it('sin zona o sin posición, null', () => {
    expect(zoneForPosition(NCAT, 8)).toBeNull();
    expect(zoneForPosition(NCAT, null)).toBeNull();
    expect(zoneForPosition([], 1)).toBeNull();
  });
  it('respeta fase y grupo: una zona de grupo solo aplica a ese grupo', () => {
    const z: StandingsZone[] = [
      { kind: 'final_phase', posFrom: 1, posTo: 2, target: null, phaseId: 'p1', groupName: 'A' },
    ];
    expect(zoneForPosition(z, 1, { phaseId: 'p1', groupName: 'A' })).toMatchObject({ kind: 'final_phase' });
    expect(zoneForPosition(z, 1, { phaseId: 'p1', groupName: 'B' })).toBeNull();
    expect(zoneForPosition(z, 1, { phaseId: 'p2', groupName: 'A' })).toBeNull();
  });
});

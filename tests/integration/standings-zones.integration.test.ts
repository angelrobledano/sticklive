/**
 * B2 — zonas de clasificación como datos, aplicadas en el servidor.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, closeDb, upsertStanding, replaceStandingsZones, getStandingsZones, copyStandingsZones } from '@sports/db';
import { limpiar } from './support/db.js';
import { crearDeporte, crearCompeticion, crearTemporada, crearEquipo } from './support/factorias.js';
import { standingsRouter } from '../../apps/api/src/routes/standings.js';

beforeEach(limpiar);
afterAll(closeDb);

const C = { played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0 };
const ZONAS = [
  { kind: 'champion' as const, posFrom: 1, posTo: 1, target: null, phaseId: null, groupName: null },
  { kind: 'relegation' as const, posFrom: 3, posTo: 3, target: 'OK Liga Plata', phaseId: null, groupName: null },
];

describe('B2 — standings_zones', () => {
  it('reemplaza y lee las zonas de una temporada, con su fuente normativa', async () => {
    const sportId = await crearDeporte();
    const season = await crearTemporada(await crearCompeticion(sportId));
    await replaceStandingsZones(season, ZONAS, 'Bases OK Liga 26/27 art. 4');
    await expect(getStandingsZones(season)).resolves.toEqual(ZONAS);
    await replaceStandingsZones(season, [ZONAS[0]!], 'Bases OK Liga 26/27 art. 4');
    await expect(getStandingsZones(season)).resolves.toHaveLength(1);
  });

  it('exige fuente normativa', async () => {
    const sportId = await crearDeporte();
    const season = await crearTemporada(await crearCompeticion(sportId));
    await expect(replaceStandingsZones(season, ZONAS, '  ')).rejects.toThrow(/fuente/i);
  });

  it('copia las zonas de la temporada anterior (sin fase: las fases no se trasladan)', async () => {
    const sportId = await crearDeporte();
    const comp = await crearCompeticion(sportId);
    const s1 = await crearTemporada(comp, { esActual: false });
    const s2 = await crearTemporada(comp);
    await replaceStandingsZones(s1, ZONAS, 'Bases 25/26');
    await expect(copyStandingsZones(s1, s2)).resolves.toBe(2);
    await expect(getStandingsZones(s2)).resolves.toEqual(ZONAS);
  });

  it('GET /seasons/:id/standings devuelve la zona de cada fila', async () => {
    const sportId = await crearDeporte();
    const season = await crearTemporada(await crearCompeticion(sportId));
    const equipos = [await crearEquipo(sportId, 'A'), await crearEquipo(sportId, 'B'), await crearEquipo(sportId, 'C')];
    for (const [i, t] of equipos.entries()) await upsertStanding({ ...C, seasonId: season, teamId: t, position: i + 1 });
    await replaceStandingsZones(season, ZONAS, 'Bases');
    const res = await standingsRouter.request(`/${season}/standings`);
    const body = await res.json() as { standings: Array<{ position: number; zone: { kind: string; target: string | null } | null }> };
    expect(body.standings.map((r) => r.zone?.kind ?? null)).toEqual(['champion', null, 'relegation']);
    expect(body.standings[2]!.zone).toMatchObject({ target: 'OK Liga Plata' });
  });
});

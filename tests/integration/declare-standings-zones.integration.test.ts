/**
 * B2 — zonas declaradas desde las bases de competición (OK Liga 2026/27).
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, closeDb, getStandingsZones } from '@sports/db';
import { limpiar } from './support/db.js';
import { crearDeporte, crearFuente } from './support/factorias.js';
import { declareStandingsZones, CATALOG } from '../../apps/etl/src/declare-standings-zones.js';

beforeEach(limpiar);
afterAll(closeDb);

async function okLiga(idc: string, season = '2026/27') {
  const sportId = await crearDeporte();
  const sourceId = await crearFuente();
  const comp = (await db.query<{ id: string }>(
    `INSERT INTO competitions (sport_id, name, slug) VALUES ($1,'OK LIGA','ok-liga-${idc}') RETURNING id`, [sportId])).rows[0]!.id;
  await db.query(`INSERT INTO competition_sources (competition_id, source_id, external_ids) VALUES ($1,$2,$3)`,
    [comp, sourceId, JSON.stringify({ idc })]);
  return (await db.query<{ id: string }>(
    `INSERT INTO seasons (competition_id, name, slug) VALUES ($1,$2,$3) RETURNING id`, [comp, season, season.replace('/', '-')])).rows[0]!.id;
}

describe('declareStandingsZones', () => {
  it('dry-run no escribe; --write declara playoff 1-8, 9-10 de colocación y tres descensos', async () => {
    const s = await okLiga('3568');
    const dry = await declareStandingsZones({ write: false, catalog: CATALOG.filter((c) => c.idc === '3568') });
    expect(dry).toEqual([{ label: 'OK Liga Masculina', seasonId: s, changed: true }]);
    expect(await getStandingsZones(s)).toEqual([]);

    await declareStandingsZones({ write: true, catalog: CATALOG.filter((c) => c.idc === '3568') });
    const zones = await getStandingsZones(s);
    expect(zones.map((z) => [z.kind, z.posFrom, z.posTo])).toEqual([
      ['final_phase', 1, 8], ['placement', 9, 10], ['relegation', 12, 14],
    ]);
    const note = await db.query<{ source_note: string }>(`SELECT DISTINCT source_note FROM standings_zones`);
    expect(note.rows[0]!.source_note).toMatch(/Bases.*2026\/27.*9\.1/);
  });

  it('es idempotente y omite temporadas que no existen', async () => {
    await okLiga('3568');
    await declareStandingsZones({ write: true });
    const again = await declareStandingsZones({ write: true });
    expect(again.find((r) => r.label === 'OK Liga Masculina')?.changed).toBe(false);
    expect(again.find((r) => r.label === 'OK Liga Iberdrola')).toEqual({ label: 'OK Liga Iberdrola', seasonId: null, changed: false });
  });
});

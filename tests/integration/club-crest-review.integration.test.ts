/**
 * Panel /admin/clubes — grupos de equipos por escudo para revisar antes del
 * backfill de clubes. Caso Calafell: un equipo con club y tres históricos sin
 * club con el mismo escudo; y dos clubes duplicados del backfill 1:1.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, closeDb, listCrestReviewGroups } from '@sports/db';
import { limpiar } from './support/db.js';
import { crearDeporte, crearEquipo } from './support/factorias.js';

beforeEach(limpiar);
afterAll(closeDb);

const CALAFELL = 'https://sidgad.cloud/rfep/images/logos_clubes/calafell.png';
const REUS = 'https://sidgad.cloud/rfep/images/logos_clubes/reus_1.png';

async function equipo(sportId: string, nombre: string, logo: string | null, clubId: string | null = null) {
  const id = await crearEquipo(sportId, nombre);
  await db.query(`UPDATE teams SET logo_url = $2, club_id = $3 WHERE id = $1`, [id, logo, clubId]);
  return id;
}
const club = async (sportId: string, nombre: string) => (await db.query<{ id: string }>(
  `INSERT INTO clubs (sport_id, canonical_name, slug) VALUES ($1,$2,$3) RETURNING id`,
  [sportId, nombre, nombre.toLowerCase().replace(/\s+/g, '-')])).rows[0]!.id;

describe('listCrestReviewGroups', () => {
  it('agrupa por escudo y marca equipos sin club y clubes duplicados', async () => {
    const s = await crearDeporte();
    const cal = await club(s, 'CALAFELL LA MENORQUINA');
    await equipo(s, 'CALAFELL LA MENORQUINA', CALAFELL, cal);
    await equipo(s, 'PARLEM CALAFELL', CALAFELL);
    await equipo(s, "CP CALAFELL TOT L'ANY", CALAFELL);
    const r1 = await club(s, 'REUS DEPORTIU');
    const r2 = await club(s, 'REUS DEPORTIU LA FIRA');
    await equipo(s, 'REUS DEPORTIU', REUS, r1);
    await equipo(s, 'REUS DEPORTIU LA FIRA', 'https://sidgad.cloud/rfep/images/logos_clubes/reus.png', r2);
    await equipo(s, 'SOLO', 'https://sidgad.cloud/rfep/images/logos_clubes/solo.png', await club(s, 'SOLO'));
    await equipo(s, 'SIN ESCUDO', null);
    await equipo(s, 'GENÉRICO', 'https://sidgad.cloud/rfep/images/logos_clubes/0.png');

    const groups = await listCrestReviewGroups();
    expect(groups.map((g) => [g.key, g.status, g.teams.length])).toEqual([
      ['rfep:reus', 'merge', 2],
      ['rfep:calafell', 'pending', 3],
    ]);
    const calafell = groups[1]!;
    expect(calafell.clubs.map((c) => c.name)).toEqual(['CALAFELL LA MENORQUINA']);
    expect(calafell.teams.filter((t) => !t.clubId).map((t) => t.name).sort()).toEqual(["CP CALAFELL TOT L'ANY", 'PARLEM CALAFELL']);
  });

  it('separa el mismo fichero de escudo en portales distintos', async () => {
    const s = await crearDeporte();
    await equipo(s, 'A', 'https://sidgad.cloud/rfep/images/logos_clubes/322.png');
    await equipo(s, 'B', 'https://sidgad.cloud/fecapa/images/logos_clubes/322.png');
    await equipo(s, 'C', 'https://sidgad.cloud/fecapa/images/logos_clubes/322_1.png');
    const groups = await listCrestReviewGroups();
    expect(groups.map((g) => [g.key, g.teams.length])).toEqual([['fecapa:322', 2], ['rfep:322', 1]]);
  });

  it('onlyIssues oculta los grupos que ya están bien', async () => {
    const s = await crearDeporte();
    const c = await club(s, 'X');
    await equipo(s, 'X1', CALAFELL, c);
    await equipo(s, 'X2', CALAFELL, c);
    expect(await listCrestReviewGroups()).toHaveLength(1);
    expect(await listCrestReviewGroups({ onlyIssues: true })).toHaveLength(0);
  });
});

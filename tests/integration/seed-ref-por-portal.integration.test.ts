/**
 * El id de equipo de sidgad (`5177`) lo numera cada portal por separado: el
 * 5177 de la FGP (Galicia) es el ROLLER LODI de la FISR. El seed buscaba la
 * ref en toda la BD y reutilizaba el equipo de OTRA federación cuando género y
 * categoría coincidían. La ref solo identifica al equipo dentro de su portal.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, closeDb, recordSeasonTeamRef, findSeasonTeamRefOwners } from '@sports/db';
import { limpiar } from './support/db.js';
import { crearDeporte, crearCompeticion, crearTemporada } from './support/factorias.js';

beforeEach(limpiar);
afterAll(closeDb);

async function equipo(sportId: string, name: string, ref: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO teams (sport_id, name, slug, source_ref) VALUES ($1,$2,$2,$3) RETURNING id`,
    [sportId, name, ref]);
  return rows[0]!.id;
}

async function compConRef(sportId: string, sourceRef: string): Promise<string> {
  const comp = await crearCompeticion(sportId);
  await db.query(`UPDATE competitions SET source_ref = $2 WHERE id = $1`, [comp, sourceRef]);
  return crearTemporada(comp);
}

describe('findSeasonTeamRefOwners', () => {
  it('devuelve cada equipo inscrito con la ref y la ref de su competición', async () => {
    const sportId = await crearDeporte();
    const lodi = await equipo(sportId, 'ROLLER LODI', '5177');
    const oleiros = await equipo(sportId, 'CLUB HOCKEY OLEIROS D', 'otra');
    await recordSeasonTeamRef(await compConRef(sportId, 'fisr_competition_5001'), lodi, '5177');
    await recordSeasonTeamRef(await compConRef(sportId, 'fgp_competition_4853934'), oleiros, '5177');

    const owners = await findSeasonTeamRefOwners('5177');
    expect(owners).toHaveLength(2);
    expect(owners).toEqual(expect.arrayContaining([
      { teamId: lodi, competitionSourceRef: 'fisr_competition_5001' },
      { teamId: oleiros, competitionSourceRef: 'fgp_competition_4853934' },
    ]));
  });

  it('sin inscripciones con esa ref devuelve vacío aunque teams.source_ref coincida', async () => {
    const sportId = await crearDeporte();
    await equipo(sportId, 'ROLLER LODI', '5177');
    await expect(findSeasonTeamRefOwners('5177')).resolves.toEqual([]);
  });
});

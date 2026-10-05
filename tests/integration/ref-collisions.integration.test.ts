/**
 * #228 — Colisiones de refs entre entidades del mismo tipo.
 *
 * Las refs de sidgad se importan sin namespacing por portal, así que la misma
 * ref puede designar 2-3 entidades. Este check (read-only) las detecta para la
 * guarda del ciclo de importación; la corrección (scoping/nombres) es aparte.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, closeDb } from '@sports/db';
import { limpiar } from './support/db.js';
import { crearDeporte, crearCompeticion } from './support/factorias.js';
import { countRefCollisions } from '../../apps/etl/src/ref-collisions.js';

beforeEach(async () => {
  await limpiar();
});

afterAll(async () => {
  await closeDb();
});

describe('ref-collisions (#228)', () => {
  it('sin refs compartidas → 0', async () => {
    await crearDeporte();
    expect(await countRefCollisions()).toEqual({ teams: 0, competitions: 0, seasons: 0 });
  });

  it('detecta la misma ref en dos equipos (source_ref y alt_source_refs)', async () => {
    const sportId = await crearDeporte();
    await db.query(
      `INSERT INTO teams (sport_id, name, slug, source_ref) VALUES
         ($1,'A','ref-col-a','1450'), ($1,'B','ref-col-b','1450')`, [sportId]);
    await db.query(
      `INSERT INTO teams (sport_id, name, slug, source_ref, alt_source_refs) VALUES
         ($1,'C','ref-col-c','r-c','{3075}'), ($1,'D','ref-col-d','r-d','{3075}')`, [sportId]);

    expect((await countRefCollisions()).teams).toBe(2);
  });

  it('detecta la misma ref (idc) en dos competiciones y en dos temporadas', async () => {
    const sportId = await crearDeporte();
    await db.query(
      `INSERT INTO competitions (sport_id, name, slug, source_ref) VALUES
         ($1,'X','ref-comp-x','500'), ($1,'Y','ref-comp-y','500')`, [sportId]);
    const compId = await crearCompeticion(sportId);
    await db.query(
      `INSERT INTO seasons (competition_id, name, slug, source_ref) VALUES
         ($1,'S1','ref-sea-1','499'), ($1,'S2','ref-sea-2','499')`, [compId]);

    const c = await countRefCollisions();
    expect(c.competitions).toBe(1);
    expect(c.seasons).toBe(1);
  });
});

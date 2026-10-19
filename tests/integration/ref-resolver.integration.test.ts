/**
 * #228 — El `RefResolver` no debe resolver por `source_ref` cuando la ref casa
 * con MÁS de un equipo (colisión entre portales sidgad): antes cogía "la primera"
 * a ciegas. Si es ambigua, sigue la cascada y, sin resolución, falla en vez de
 * devolver el equipo equivocado.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, closeDb } from '@sports/db';
import { limpiar } from './support/db.js';
import { crearDeporte } from './support/factorias.js';
import { RefResolver } from '../../apps/etl/src/loaders/ref-resolver.js';

beforeEach(async () => {
  await limpiar();
});

afterAll(async () => {
  await closeDb();
});

async function equipo(sportId: string, name: string, slug: string, ref: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO teams (sport_id, name, slug, source_ref) VALUES ($1,$2,$3,$4) RETURNING id`,
    [sportId, name, slug, ref]);
  return rows[0]!.id;
}

async function equipoConSeccion(
  sportId: string,
  name: string,
  slug: string,
  ref: string,
  gender: 'male' | 'female',
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO teams (sport_id, name, slug, source_ref, gender, age_category)
     VALUES ($1,$2,$3,$4,$5,'senior') RETURNING id`,
    [sportId, name, slug, ref, gender]);
  return rows[0]!.id;
}

describe('RefResolver — refs ambiguas (#228)', () => {
  it('resuelve por ref cuando es única', async () => {
    const sportId = await crearDeporte();
    const id = await equipo(sportId, 'C.E. NOIA', 'ce-noia-amb', '1450');

    const resolver = new RefResolver(sportId);
    expect(await resolver.resolveTeam('1450')).toBe(id);
  });

  it('NO resuelve por ref si casa con >1 equipo (no coge la primera)', async () => {
    const sportId = await crearDeporte();
    await equipo(sportId, 'C.E. NOIA', 'ce-noia-amb2', '1450');
    await equipo(sportId, 'CH CASTELLAR', 'ch-castellar-amb2', '1450');

    const resolver = new RefResolver(sportId);
    await expect(resolver.resolveTeam('1450')).rejects.toThrow(/No se encontró equipo/);
  });

  it('NO acepta un alias que contradice el género de la competición (#194)', async () => {
    const sportId = await crearDeporte();
    const femenino = await equipoConSeccion(
      sportId, 'CH MATARÓ', 'ch-mataro-fem', '3726', 'female',
    );
    await db.query(
      `INSERT INTO team_aliases (team_id, raw_text, normalized, source_id, created_by)
       VALUES ($1, 'CH MATARÓ', 'ch mataro', NULL, 'deterministic')`,
      [femenino],
    );

    const resolver = new RefResolver(sportId);
    // La competición es masculina: el alias homónimo femenino no es el equipo.
    await expect(
      resolver.resolveTeam('CH MATARÓ', undefined, { gender: 'male', ageCategory: 'senior' }),
    ).rejects.toThrow(/No se encontró equipo/);
  });

  it('sí acepta el alias cuando las señales coinciden', async () => {
    const sportId = await crearDeporte();
    const femenino = await equipoConSeccion(
      sportId, 'CH MATARÓ', 'ch-mataro-fem-ok', '3727', 'female',
    );
    await db.query(
      `INSERT INTO team_aliases (team_id, raw_text, normalized, source_id, created_by)
       VALUES ($1, 'CH MATARÓ', 'ch mataro', NULL, 'deterministic')`,
      [femenino],
    );

    const resolver = new RefResolver(sportId);
    expect(
      await resolver.resolveTeam('CH MATARÓ', undefined, { gender: 'female', ageCategory: 'senior' }),
    ).toBe(femenino);
  });

  it('NO acepta un source_ref cuyo equipo contradice el género (#194)', async () => {
    const sportId = await crearDeporte();
    await equipoConSeccion(sportId, 'CH MATARÓ', 'ch-mataro-ref-fem', '3728', 'female');

    const resolver = new RefResolver(sportId);
    await expect(
      resolver.resolveTeam('3728', undefined, { gender: 'male', ageCategory: 'senior' }),
    ).rejects.toThrow(/No se encontró equipo/);
  });
});

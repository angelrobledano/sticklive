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
});

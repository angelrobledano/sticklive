/**
 * 100 — curación de destacadas: featured_rank define «destacada»; las copas
 * pierden el tier de liga (no se cuelan en Partidos de otros países).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, closeDb } from '@sports/db';
import { limpiar } from './support/db.js';
import { crearDeporte, crearCompeticion } from './support/factorias.js';

const SQL = readFileSync(fileURLToPath(new URL('../../packages/db/migrations/100_featured_competitions.sql', import.meta.url)), 'utf8');

beforeEach(limpiar);
afterAll(closeDb);

async function comp(slug: string, tier: number | null = null, featured: number | null = null) {
  const id = await crearCompeticion(await crearDeporte());
  await db.query(`UPDATE competitions SET slug = $2, tier = $3, featured_rank = $4 WHERE id = $1`, [id, slug, tier, featured]);
  return id;
}
const row = async (id: string) =>
  (await db.query<{ tier: number | null; featured_rank: number | null }>(`SELECT tier, featured_rank FROM competitions WHERE id = $1`, [id])).rows[0]!;

describe('100 — competiciones destacadas', () => {
  it('cura la lista, quita el destacado al resto y el tier a las copas; idempotente', async () => {
    const okLiga = await comp('ok-liga-masculina', 1, 5);
    const placard = await comp('campeonato-placard-portugal');
    const taca = await comp('taca-de-portugal', 1);
    const regional = await comp('primera-catalana-masculina', null, 99);
    const bronce = await comp('ok-liga-bronce-masculina-norte', 3);

    await db.query(SQL);
    await db.query(SQL);

    expect(await row(okLiga)).toEqual({ tier: 1, featured_rank: 1 });
    expect(await row(placard)).toEqual({ tier: 1, featured_rank: 2 });
    expect(await row(taca)).toEqual({ tier: null, featured_rank: 46 });
    expect(await row(regional)).toEqual({ tier: null, featured_rank: null });
    expect(await row(bronce)).toEqual({ tier: 3, featured_rank: 24 });
  });
});

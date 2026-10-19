/**
 * Reparto nombre/apellidos de jugadores ya guardados (C1).
 *
 * El alta partía "PASCUAL MATÍAS JOSÉ" por la última palabra. Al re-scrapear,
 * el acta trae el nombre de pila y `fixPlayerNameSplit` lo corrige, pero solo
 * si son las mismas palabras: un nombre editado a mano no se toca.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, closeDb, fixPlayerNameSplit } from '@sports/db';
import { limpiar } from './support/db.js';
import { crearDeporte } from './support/factorias.js';

async function jugador(first: string, last: string): Promise<string> {
  const sportId = await crearDeporte();
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO players (sport_id, first_name, last_name, slug) VALUES ($1, $2, $3, 'p') RETURNING id`,
    [sportId, first, last]
  );
  return rows[0]!.id;
}

async function nombre(id: string) {
  const { rows } = await db.query<{ first_name: string; last_name: string }>(
    `SELECT first_name, last_name FROM players WHERE id = $1`, [id]
  );
  return rows[0];
}

beforeEach(limpiar);
afterAll(closeDb);

describe('fixPlayerNameSplit', () => {
  it('reordena un nombre compuesto mal repartido', async () => {
    const id = await jugador('JOSÉ', 'PASCUAL MATÍAS');
    expect(await fixPlayerNameSplit(id, 'MATÍAS JOSÉ', 'PASCUAL')).toBe(true);
    expect(await nombre(id)).toEqual({ first_name: 'MATÍAS JOSÉ', last_name: 'PASCUAL' });
  });

  it('no toca un nombre corregido a mano (otras palabras)', async () => {
    const id = await jugador('Pepe', 'Pascual');
    expect(await fixPlayerNameSplit(id, 'MATÍAS JOSÉ', 'PASCUAL')).toBe(false);
    expect(await nombre(id)).toEqual({ first_name: 'Pepe', last_name: 'Pascual' });
  });

  it('si ya está bien, no escribe', async () => {
    const id = await jugador('MATÍAS JOSÉ', 'PASCUAL');
    expect(await fixPlayerNameSplit(id, 'MATÍAS JOSÉ', 'PASCUAL')).toBe(false);
  });
});
